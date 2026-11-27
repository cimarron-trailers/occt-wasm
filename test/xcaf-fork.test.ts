// SPDX-License-Identifier: MIT OR Apache-2.0
// SPDX-FileCopyrightText: Cimarron Trailers

/**
 * The cimarron-trailers fork's XCAF calls (xtask/src/codegen/fork_xcaf.rs): an
 * assembly of any size, written in the unit its numbers are in.
 * - a component is placed by a rigid 3x4 matrix and reads it back; a matrix that
 *   scales, shears or reflects is refused;
 * - a part or a sub-assembly placed many times is written once;
 * - the file declares the unit it was given and converts none of its numbers, and
 *   the next plain export still writes OCCT's own unit;
 * - adding components takes time in proportion to their number (upstream's
 *   `addChild` recomputes every assembly after each one: quadratic).
 *
 * Every oracle reads the written file back, through upstream's own reader.
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { OcctKernel, ShapeHandle, StepLengthUnit, XCAFDocument } from "../ts/src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

let kernel: OcctKernel;

/** A kernel on a module of its own: its own memory, so OCCT's statics start unset. */
async function freshKernel(): Promise<OcctKernel> {
    const jsPath = resolve(__dirname, "../dist/occt-wasm.js");
    const wasmPath = resolve(__dirname, "../dist/occt-wasm.wasm");
    const createModule = (await import(jsPath)).default;
    const Module = await createModule({
        locateFile: (p: string) => (p.endsWith(".wasm") ? wasmPath : p),
    });
    const mod = await import(resolve(__dirname, "../ts/src/index.ts"));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new (mod.OcctKernel as any)(Module);
}

beforeAll(async () => {
    kernel = await freshKernel();
}, 30_000);

afterEach(() => kernel.releaseAll());
afterAll(() => kernel[Symbol.dispose]());

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

/** A turn of `angle` about Z, then a move by `t`: rigid. */
function turnZ(angle: number, t: [number, number, number]): number[] {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return [c, -s, 0, t[0], s, c, 0, t[1], 0, 0, 1, t[2]];
}

function count(text: string, entity: string): number {
    return text.split(`${entity}(`).length - 1;
}

function withDocument<R>(fn: (doc: XCAFDocument) => R): R {
    const doc = kernel.createXCAFDocument();
    try {
        return fn(doc);
    } finally {
        doc.close();
    }
}

/** The size of the file's one root, read back: OCCT reads every STEP into millimetres. */
function rootExtentInMm(step: string): [number, number, number] {
    const back = kernel.importXCAFFromSTEP(step);
    try {
        const roots = back.getRoots();
        expect(roots).toHaveLength(1);
        const shape = back.getLabelInfo(roots[0]!).shapeHandle as ShapeHandle;
        const b = kernel.getBoundingBox(shape);
        kernel.release(shape);
        return [b.xmax - b.xmin, b.ymax - b.ymin, b.zmax - b.zmin];
    } finally {
        back.close();
    }
}

describe("addComponentAt: a placement is rigid", () => {
    it("reads back the matrix it was given", () => {
        withDocument((doc) => {
            const part = doc.addShape(kernel.makeBox(10, 20, 30), { name: "plate" });
            const root = doc.addAssembly({ name: "frame" });
            const m = turnZ(Math.PI / 3, [100, -40, 7.5]);
            const comp = doc.addComponentAt(root, part, m, { name: "plate <1>" });
            const back = doc.getLocation(comp);
            for (let i = 0; i < 12; i++) expect(back[i]).toBeCloseTo(m[i]!, 12);
            expect(doc.getReferredLabel(comp)).toBe(part);
        });
    });

    it("refuses a matrix that scales, shears or reflects", () => {
        withDocument((doc) => {
            const part = doc.addShape(kernel.makeBox(1, 1, 1));
            const root = doc.addAssembly();
            const scale = [2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
            const shear = [1, 0.5, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
            const mirror = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0];
            expect(() => doc.addComponentAt(root, part, scale)).toThrow(/not rigid/);
            expect(() => doc.addComponentAt(root, part, shear)).toThrow(/not rigid/);
            expect(() => doc.addComponentAt(root, part, mirror)).toThrow(/reflects/);
            expect(() => doc.addComponentAt(root, part, [1, 0, 0])).toThrow(/12 elements/);
        });
    });

    it("places only in an assembly, and never an assembly in itself", () => {
        withDocument((doc) => {
            const part = doc.addShape(kernel.makeBox(1, 1, 1));
            const other = doc.addShape(kernel.makeBox(2, 2, 2));
            const root = doc.addAssembly();
            expect(() => doc.addComponentAt(part, other, IDENTITY)).toThrow(/must be an assembly/);
            expect(() => doc.addComponentAt(root, root, IDENTITY)).toThrow(/cannot contain itself/);
            const comp = doc.addComponentAt(root, part, IDENTITY);
            expect(() => doc.addComponentAt(root, comp, IDENTITY)).toThrow(/not a component/);
        });
    });
});

describe("one definition, however often it is placed", () => {
    // The export read OCCT's STEP statics before making the writer that sets them,
    // so a module's FIRST export wrote every placement as a part of its own. Every
    // other test here exports into a module that has exported before.
    it("writes a part placed 20 times as one solid in a module's first export", async () => {
        const first = await freshKernel();
        try {
            const doc = first.createXCAFDocument();
            const part = doc.addShape(first.makeBox(10, 20, 30), { name: "plate" });
            const root = doc.addAssembly({ name: "frame" });
            for (let i = 0; i < 20; i++) doc.addComponentAt(root, part, turnZ(i * 0.01, [i * 40, 0, 0]));
            const step = doc.exportSTEPInUnit("MM");
            doc.close();
            expect(count(step, "MANIFOLD_SOLID_BREP")).toBe(1);
            expect(count(step, "NEXT_ASSEMBLY_USAGE_OCCURRENCE")).toBe(20);
        } finally {
            first.releaseAll();
            first[Symbol.dispose]();
        }
    }, 30_000);

    it("writes a part placed 1,000 times as one solid", () => {
        const step = withDocument((doc) => {
            const part = doc.addShape(kernel.makeBox(10, 20, 30), { name: "plate" });
            const root = doc.addAssembly({ name: "frame" });
            for (let i = 0; i < 1000; i++) doc.addComponentAt(root, part, turnZ(i * 0.01, [i * 40, 0, 0]));
            return doc.exportSTEPInUnit("MM");
        });
        expect(count(step, "MANIFOLD_SOLID_BREP")).toBe(1);
        expect(count(step, "NEXT_ASSEMBLY_USAGE_OCCURRENCE")).toBe(1000);
    });

    it("writes a sub-assembly placed twice once, both places referring to it", () => {
        const step = withDocument((doc) => {
            const part = doc.addShape(kernel.makeBox(10, 20, 30), { name: "plate" });
            const sub = doc.addAssembly({ name: "bracket" });
            doc.addComponentAt(sub, part, IDENTITY);
            doc.addComponentAt(sub, part, turnZ(0, [0, 0, 40]));
            const root = doc.addAssembly({ name: "frame" });
            doc.addComponentAt(root, sub, IDENTITY);
            doc.addComponentAt(root, sub, turnZ(Math.PI, [500, 0, 0]));
            return doc.exportSTEPInUnit("MM");
        });
        expect(count(step, "MANIFOLD_SOLID_BREP")).toBe(1);
        expect(count(step, "NEXT_ASSEMBLY_USAGE_OCCURRENCE")).toBe(4);
        const back = kernel.importXCAFFromSTEP(step);
        try {
            const [root] = back.getRoots();
            const places = back.getChildren(root!);
            expect(places).toHaveLength(2);
            expect(back.getReferredLabel(places[0]!)).toBe(back.getReferredLabel(places[1]!));
        } finally {
            back.close();
        }
    });
});

describe("exportSTEPInUnit: the file is in the unit of its numbers", () => {
    const cases: [StepLengthUnit, number, RegExp][] = [
        ["MM", 1, /SI_UNIT\(\.MILLI\.,\.METRE\.\)/],
        ["CM", 10, /SI_UNIT\(\.CENTI\.,\.METRE\.\)/],
        ["M", 1000, /SI_UNIT\(\$,\.METRE\.\)/],
        ["INCH", 25.4, /CONVERSION_BASED_UNIT\('INCH'/],
        ["FT", 304.8, /CONVERSION_BASED_UNIT\('FOOT'/],
    ];
    for (const [unit, mmPerUnit, declared] of cases) {
        it(`writes ${unit}, and a 10 x 20 x 30 box reads back as 10 x 20 x 30 ${unit}`, () => {
            const step = withDocument((doc) => {
                const part = doc.addShape(kernel.makeBox(10, 20, 30), { name: "plate" });
                const root = doc.addAssembly({ name: "frame" });
                doc.addComponentAt(root, part, IDENTITY);
                return doc.exportSTEPInUnit(unit);
            });
            expect(step).toMatch(declared);
            const [x, y, z] = rootExtentInMm(step);
            expect(x / mmPerUnit).toBeCloseTo(10, 3);
            expect(y / mmPerUnit).toBeCloseTo(20, 3);
            expect(z / mmPerUnit).toBeCloseTo(30, 3);
        });
    }

    it("leaves the next plain export in OCCT's own unit", () => {
        withDocument((doc) => {
            const root = doc.addAssembly();
            doc.addComponentAt(root, doc.addShape(kernel.makeBox(1, 1, 1)), IDENTITY);
            expect(doc.exportSTEPInUnit("INCH")).toMatch(/CONVERSION_BASED_UNIT\('INCH'/);
        });
        const plain = withDocument((doc) => {
            doc.addShape(kernel.makeBox(1, 1, 1));
            return doc.exportSTEP();
        });
        expect(plain).toMatch(/SI_UNIT\(\.MILLI\.,\.METRE\.\)/);
        expect(plain).not.toMatch(/'INCH'/);
    });

    it("refuses a unit it does not know", () => {
        withDocument((doc) => {
            doc.addAssembly();
            expect(() => doc.exportSTEPInUnit("YARD" as StepLengthUnit)).toThrow(/unknown unit/);
        });
    });
});

describe("adding components takes time in proportion to their number", () => {
    function timeToAdd(n: number): number {
        return withDocument((doc) => {
            const part = doc.addShape(kernel.makeBox(10, 20, 30));
            const root = doc.addAssembly();
            const t0 = performance.now();
            for (let i = 0; i < n; i++) doc.addComponentAt(root, part, turnZ(0, [i * 40, 0, 0]));
            return performance.now() - t0;
        });
    }

    it("adds four times the components in well under sixteen times the time", () => {
        timeToAdd(400); // warm the arena and the JIT
        const small = Math.max(timeToAdd(1600), 1);
        const large = timeToAdd(6400);
        // Proportional is about 4x; upstream's per-add UpdateAssemblies made it about 16x.
        expect(large / small).toBeLessThan(8);
    });
});
