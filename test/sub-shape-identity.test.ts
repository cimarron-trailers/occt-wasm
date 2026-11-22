// SPDX-License-Identifier: MIT OR Apache-2.0
// SPDX-FileCopyrightText: Cimarron Trailers

/**
 * Sub-shape identity by position: the cimarron-trailers fork's calls (B1–B6 of
 * the design, backend repo .claude/docs/3d/model-sub-shape-identity.md §4, §6).
 * On a holed plate:
 * - each history op's answer equals what isSame says of every input and result face (B1);
 * - each mesh and wireframe group's position equals its sub-shape's position (B2);
 * - the adjacency equals what each face's own lists and the shape's say (B3);
 * - a shape's position in another is where isSame finds it, or none (B4);
 * - a moved copy's map is where each sub-shape's image (ModifiedShape) lands (B5);
 * - a binary BREP round trip keeps every list's order (B6, a pin: no call changes).
 *
 * Every oracle is independent of the call under test: isSame over handles, the
 * geometry, or upstream's own calls by number on a shape whose numbers are first
 * checked distinct (where every number in a list differs, a number names one
 * sub-shape exactly).
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type {
    EdgeData,
    FaceFate,
    Mesh,
    OcctKernel,
    PositionHistory,
    ShapeHandle,
    Vec3,
} from "../ts/src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

let kernel: OcctKernel;

beforeAll(async () => {
    const jsPath = resolve(__dirname, "../dist/occt-wasm.js");
    const wasmPath = resolve(__dirname, "../dist/occt-wasm.wasm");
    const createModule = (await import(jsPath)).default;
    const Module = await createModule({
        locateFile: (p: string) => (p.endsWith(".wasm") ? wasmPath : p),
    });
    const mod = await import(resolve(__dirname, "../ts/src/index.ts"));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    kernel = new (mod.OcctKernel as any)(Module);
}, 30_000);

afterEach(() => kernel.releaseAll());
afterAll(() => kernel[Symbol.dispose]());

/** The range the mesh's and wireframe's group numbers are taken in (`buildMeshData`). */
const BOUND = 2147483647;

type Kind = "face" | "edge" | "vertex";
const KINDS: readonly Kind[] = ["face", "edge", "vertex"];

/** Three through holes of distinct radii at distinct places: no two faces share a centre. */
const HOLES: readonly [number, number, number][] = [[20, 20, 4], [50, 35, 6], [80, 22, 3]];

function pin(x: number, y: number, r: number): ShapeHandle {
    return kernel.translate(kernel.makeCylinder(r, 30), x, y, -10);
}

/** A 100 × 60 × 10 plate with `holes` of {@link HOLES} through it. */
function plateWith(holes: number): ShapeHandle {
    let plate = kernel.makeBox(100, 60, 10);
    for (const [x, y, r] of HOLES.slice(0, holes)) plate = kernel.cut(plate, pin(x, y, r));
    return plate;
}

function dist(a: Vec3, b: Vec3): number {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Where each of `shape`'s sub-shapes of `kind` is: a face's centre of area, an edge's of length, a vertex's point. */
function places(shape: ShapeHandle, kind: Kind): Vec3[] {
    return kernel.getSubShapes(shape, kind).map((s) =>
        kind === "face" ? kernel.getSurfaceCenterOfMass(s)
            : kind === "edge" ? kernel.getLinearCenterOfMass(s)
                : kernel.vertexPosition(s));
}

/** The one index of `among` within `tol` of `p` — every other at least `gap` away, so never a near tie. */
function nearest(p: Vec3, among: readonly Vec3[], tol: number, gap: number): number {
    const order = among.map((q, i) => ({ i, d: dist(p, q) })).sort((a, b) => a.d - b.d);
    const [best, next] = order;
    expect(best, "a place to match").toBeDefined();
    expect(best!.d).toBeLessThan(tol);
    if (next) expect(next.d).toBeGreaterThan(gap);
    return best!.i;
}

function expectDistinct(numbers: readonly number[]): void {
    expect(new Set(numbers).size).toBe(numbers.length);
}

/** Upstream's run-encoded history, `[source, n, image_1 … image_n, …]`, as source → images. */
function runs(modified: readonly number[]): Map<number, number[]> {
    const out = new Map<number, number[]>();
    for (let i = 0; i < modified.length;) {
        const n = modified[i + 1]!;
        out.set(modified[i]!, modified.slice(i + 2, i + 2 + n));
        i += 2 + n;
    }
    return out;
}

/** Every result position a history's fates name — untouched or became — each listed once per naming. */
function namedResultFaces(history: PositionHistory): number[] {
    return history.inputs.flatMap((fates) =>
        fates.flatMap((f: FaceFate) => (f.kind === "untouched" ? [f.at] : f.kind === "modified" ? [...f.into] : [])));
}

/**
 * B1's oracle. Each input face's fate agrees with isSame against every result face —
 * untouched exactly where it isSame one, and then at that one's position; modified or deleted
 * only where it isSame none — and every face of the result comes from one input face.
 */
function expectHistoryMatchesIsSame(history: PositionHistory, inputs: readonly ShapeHandle[]): void {
    const resultFaces = kernel.getSubShapes(history.result, "face");
    expect(history.resultFaces).toBe(resultFaces.length);
    expect(history.inputs.length).toBe(inputs.length);
    inputs.forEach((input, i) => {
        const faces = kernel.getSubShapes(input, "face");
        const fates = history.inputs[i]!;
        expect(fates.length).toBe(faces.length);
        faces.forEach((face, p) => {
            const same = resultFaces.flatMap((r, q) => (kernel.isSame(face, r) ? [q] : []));
            const fate = fates[p]!;
            if (fate.kind === "untouched") expect(same, `input ${i} face ${p} untouched`).toEqual([fate.at]);
            else expect(same, `input ${i} face ${p} ${fate.kind}`).toEqual([]);
        });
    });
    expect(namedResultFaces(history).sort((a, b) => a - b)).toEqual(resultFaces.map((_, q) => q));
}

/**
 * B1's second oracle: upstream's history of the same operation, by number, on inputs and a
 * result whose numbers are each distinct — so each number names one face exactly — read
 * across to positions. The two calls each run the operation, so the results' faces are
 * paired by where they lie, never assumed to come in one order.
 */
function expectHistoryMatchesUpstream(
    history: PositionHistory,
    inputs: readonly ShapeHandle[],
    upstream: (hashes: number[]) => { result: ShapeHandle; modified: number[]; deleted: number[] },
): void {
    const inputHashes = inputs.map((s) => kernel.subShapeHashes(s, "face", BOUND));
    expectDistinct(inputHashes.flat());
    const evo = upstream(inputHashes.flat());
    const theirResult = kernel.subShapeHashes(evo.result, "face", BOUND);
    expectDistinct(theirResult);
    const ours = places(history.result, "face");
    const theirs = places(evo.result, "face");
    expect(theirs.length).toBe(ours.length);
    const toOurs = theirs.map((p) => nearest(p, ours, 1e-6, 1));

    const images = runs(evo.modified);
    const deleted = new Set(evo.deleted);
    inputs.forEach((_, i) => {
        history.inputs[i]!.forEach((fate, p) => {
            const hash = inputHashes[i]![p]!;
            const into = images.get(hash)?.map((h) => toOurs[theirResult.indexOf(h)]);
            if (fate.kind === "modified") expect(into, `input ${i} face ${p}`).toEqual(fate.into);
            else expect(into, `input ${i} face ${p}`).toBeUndefined();
            expect(deleted.has(hash), `input ${i} face ${p}`).toBe(fate.kind === "deleted");
        });
    });
}

describe("B1 history by position", () => {
    it("cut: every face of the body and the tool, as isSame and upstream's history say", () => {
        const body = plateWith(2);
        const tool = pin(...HOLES[2]!);
        const history = kernel.cutWithPositionHistory(body, tool);
        expectHistoryMatchesIsSame(history, [body, tool]);
        expectHistoryMatchesUpstream(history, [body, tool],
            (hashes) => kernel.cutWithHistory(body, tool, hashes, BOUND));
        // The new hole's wall is an image of the tool's side; its caps, outside the plate, are gone.
        const kinds = history.inputs[1]!.map((f) => f.kind).sort();
        expect(kinds).toEqual(["deleted", "deleted", "modified"]);
    });

    it("fuse: every face of the body and the tool, as isSame and upstream's history say", () => {
        const body = plateWith(3);
        const boss = kernel.translate(kernel.makeCylinder(5, 20), 35, 45, 5);
        const history = kernel.fuseWithPositionHistory(body, boss);
        expectHistoryMatchesIsSame(history, [body, boss]);
        expectHistoryMatchesUpstream(history, [body, boss],
            (hashes) => kernel.fuseWithHistory(body, boss, hashes, BOUND));
        expect(history.inputs[1]!.map((f) => f.kind).sort()).toEqual(["deleted", "modified", "untouched"]);
    });

    it("intersect: every face of the body and the tool, as isSame and upstream's history say", () => {
        const body = plateWith(3);
        const half = kernel.makeBoxFromCorners({ x: 40, y: -10, z: -10 }, { x: 120, y: 70, z: 20 });
        const history = kernel.intersectWithPositionHistory(body, half);
        expectHistoryMatchesIsSame(history, [body, half]);
        expectHistoryMatchesUpstream(history, [body, half],
            (hashes) => kernel.intersectWithHistory(body, half, hashes, BOUND));
        expect(history.inputs[0]!.some((f) => f.kind === "deleted")).toBe(true);
    });

    it("mirror: every face becomes its one image, where its reflection lies", () => {
        const body = plateWith(3);
        const point = { x: 0, y: 0, z: 0 };
        const normal = { x: 1, y: 0, z: 0 };
        const history = kernel.mirrorWithPositionHistory(body, point, normal);
        expectHistoryMatchesIsSame(history, [body]);
        expectHistoryMatchesUpstream(history, [body],
            (hashes) => kernel.mirrorWithHistory(body, point, normal, hashes, BOUND));
        const reflected = places(body, "face").map((c) => ({ x: -c.x, y: c.y, z: c.z }));
        const imagePlaces = places(history.result, "face");
        history.inputs[0]!.forEach((fate, p) => {
            expect(fate.kind).toBe("modified");
            if (fate.kind !== "modified") return;
            expect(fate.into).toEqual([nearest(reflected[p]!, imagePlaces, 1e-6, 1)]);
        });
        expect(history.generated).toEqual([]);
    });
});

/** A mesh group's centre of area, `[start, count]` into `indices`. */
function meshCentroid(mesh: Mesh, start: number, count: number): Vec3 {
    const p = mesh.positions;
    let ax = 0, ay = 0, az = 0, total = 0;
    for (let t = start; t < start + count; t += 3) {
        const [a, b, c] = [mesh.indices[t]! * 3, mesh.indices[t + 1]! * 3, mesh.indices[t + 2]! * 3];
        const u = [p[b]! - p[a]!, p[b + 1]! - p[a + 1]!, p[b + 2]! - p[a + 2]!];
        const v = [p[c]! - p[a]!, p[c + 1]! - p[a + 1]!, p[c + 2]! - p[a + 2]!];
        const area = Math.hypot(u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!) / 2;
        ax += area * (p[a]! + p[b]! + p[c]!) / 3;
        ay += area * (p[a + 1]! + p[b + 1]! + p[c + 1]!) / 3;
        az += area * (p[a + 2]! + p[b + 2]! + p[c + 2]!) / 3;
        total += area;
    }
    return { x: ax / total, y: ay / total, z: az / total };
}

/** A wireframe group's centre of length, `[start, count]` into `points` (floats). */
function polylineCentroid(edges: EdgeData, start: number, count: number): Vec3 {
    const p = edges.points;
    let ax = 0, ay = 0, az = 0, total = 0;
    for (let i = start; i + 5 < start + count; i += 3) {
        const len = Math.hypot(p[i + 3]! - p[i]!, p[i + 4]! - p[i + 1]!, p[i + 5]! - p[i + 2]!);
        ax += len * (p[i]! + p[i + 3]!) / 2;
        ay += len * (p[i + 1]! + p[i + 4]!) / 2;
        az += len * (p[i + 2]! + p[i + 5]!) / 2;
        total += len;
    }
    return { x: ax / total, y: ay / total, z: az / total };
}

function triples(groups: Int32Array): [number, number, number][] {
    const out: [number, number, number][] = [];
    for (let g = 0; g + 2 < groups.length; g += 3) out.push([groups[g]!, groups[g + 1]!, groups[g + 2]!]);
    return out;
}

describe("B2 groups by position", () => {
    it("each face group names its face's position: upstream's mesh, renamed", () => {
        const plate = plateWith(3);
        const theirs = kernel.meshShape(plate);
        const ours = kernel.meshShapeByPosition(plate);
        // One mesher: the same triangles, in the same groups.
        expect(ours.positions).toEqual(theirs.positions);
        expect(ours.normals).toEqual(theirs.normals);
        expect(ours.indices).toEqual(theirs.indices);
        const ourGroups = triples(ours.faceGroups!);
        const theirGroups = triples(theirs.faceGroups!);
        expect(ourGroups.map(([s, n]) => [s, n])).toEqual(theirGroups.map(([s, n]) => [s, n]));

        const hashes = kernel.subShapeHashes(plate, "face", BOUND);
        expectDistinct(hashes);
        const centres = places(plate, "face");
        ourGroups.forEach(([start, count, position], g) => {
            expect(hashes[position], `group ${g}`).toBe(theirGroups[g]![2]);
            expect(nearest(meshCentroid(ours, start, count), centres, 0.25, 2), `group ${g}`).toBe(position);
        });
        expect(new Set(ourGroups.map(([, , position]) => position)).size).toBe(centres.length);
    });

    it("a face the mesher walks twice names its one position both times", () => {
        const face = kernel.getSubShapes(kernel.makeBox(10, 20, 30), "face")[2]!;
        const twice = kernel.makeCompound([face, face]);
        expect(kernel.getSubShapes(twice, "face").length).toBe(1);
        const groups = triples(kernel.meshShapeByPosition(twice).faceGroups!);
        expect(groups.map(([, , position]) => position)).toEqual([0, 0]);
    });

    it("each edge group names its edge's position: upstream's wireframe, renamed", () => {
        const plate = plateWith(3);
        for (const source of ["curve", "triangulation"] as const) {
            if (source === "triangulation") kernel.meshShape(plate);
            const theirs = kernel.wireframe(plate, { deflection: 0.1, source });
            const ours = kernel.wireframeByPosition(plate, { deflection: 0.1, source });
            expect(ours.points).toEqual(theirs.points);
            const ourGroups = triples(ours.edgeGroups);
            const theirGroups = triples(theirs.edgeGroups);
            expect(ourGroups.map(([s, n]) => [s, n])).toEqual(theirGroups.map(([s, n]) => [s, n]));

            const hashes = kernel.subShapeHashes(plate, "edge", BOUND);
            expectDistinct(hashes);
            const centres = places(plate, "edge");
            ourGroups.forEach(([start, count, position], g) => {
                expect(hashes[position], `${source} group ${g}`).toBe(theirGroups[g]![2]);
                expect(nearest(polylineCentroid(ours, start, count), centres, 0.25, 2), `${source} group ${g}`)
                    .toBe(position);
            });
        }
    });

    it("an edge the wireframe skips leaves its position unnamed, never shifts the others", () => {
        // A sphere's poles are degenerate edges, which the wireframe does not draw.
        const sphere = kernel.makeSphere(10);
        const edges = kernel.getSubShapes(sphere, "edge");
        const theirs = triples(kernel.wireframe(sphere).edgeGroups);
        const ours = triples(kernel.wireframeByPosition(sphere).edgeGroups);
        expect(ours.length).toBeLessThan(edges.length);
        const hashes = kernel.subShapeHashes(sphere, "edge", BOUND);
        expectDistinct(hashes);
        expect(ours.map(([, , position]) => hashes[position])).toEqual(theirs.map(([, , hash]) => hash));
        // A drawn edge comes after a skipped one in the list, so a group's index is not its position.
        expect(ours.map(([, , position]) => position)).not.toEqual(ours.map((_, g) => g));
    });
});

describe("B3 adjacency by position", () => {
    it("equals what each face's own lists and the shape's say, by isSame", () => {
        const plate = plateWith(3);
        const adjacency = kernel.adjacencyByPosition(plate);
        const faces = kernel.getSubShapes(plate, "face");
        const edges = kernel.getSubShapes(plate, "edge");
        const vertices = kernel.getSubShapes(plate, "vertex");
        const positionOf = (sub: ShapeHandle, list: readonly ShapeHandle[]) => {
            const at = list.flatMap((s, i) => (kernel.isSame(s, sub) ? [i] : []));
            expect(at.length).toBe(1);
            return at[0]!;
        };
        const faceEdges = faces.map((f) => kernel.getSubShapes(f, "edge").map((e) => positionOf(e, edges)));
        const faceVertices = faces.map((f) => kernel.getSubShapes(f, "vertex").map((v) => positionOf(v, vertices)));
        expect(adjacency.faceEdges).toEqual(faceEdges);
        expect(adjacency.faceVertices).toEqual(faceVertices);
        expect(adjacency.edgeFaces).toEqual(edges.map((_, e) =>
            faceEdges.flatMap((own, f) => (own.includes(e) ? [f] : []))));
        // A hole's seam bounds its wall once, though the wall's wire runs along it twice.
        const walls = adjacency.faceEdges.filter((own) => own.length === 3);
        expect(walls.length).toBe(HOLES.length);
    });

    it("each edge's faces equal upstream's edgeToFaceMap on distinct numbers", () => {
        const plate = plateWith(3);
        const adjacency = kernel.adjacencyByPosition(plate);
        const faceHashes = kernel.subShapeHashes(plate, "face", BOUND);
        const edgeHashes = kernel.subShapeHashes(plate, "edge", BOUND);
        expectDistinct(faceHashes);
        expectDistinct(edgeHashes);
        const map = kernel.edgeToFaceMap(plate, BOUND);
        const theirs = new Map<number, number[]>();
        for (let i = 0; i < map.length;) {
            const n = map[i + 1]!;
            theirs.set(edgeHashes.indexOf(map[i]!), map.slice(i + 2, i + 2 + n).map((h) => faceHashes.indexOf(h)));
            i += 2 + n;
        }
        adjacency.edgeFaces.forEach((faces, e) => {
            expect([...new Set(theirs.get(e) ?? [])].sort((a, b) => a - b), `edge ${e}`).toEqual(faces);
        });
    });
});

describe("B4 where one shape sits in another", () => {
    it("is its isSame position in the other's list, or none", () => {
        const plate = plateWith(3);
        for (const kind of KINDS) {
            kernel.getSubShapes(plate, kind).forEach((sub, i) => expect(kernel.subShapePosition(plate, sub)).toBe(i));
        }
        // A copy, or the same topology placed elsewhere, is another shape: in no list of this one.
        const moved = kernel.translate(plate, 0, 0, 50);
        const placed = kernel.located(plate, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 50]);
        for (const other of [moved, placed]) {
            for (const kind of KINDS) {
                for (const sub of kernel.getSubShapes(other, kind)) expect(kernel.subShapePosition(plate, sub)).toBeNull();
            }
        }
        const [solid] = kernel.getSubShapes(plate, "solid");
        const [movedSolid] = kernel.getSubShapes(moved, "solid");
        const both = kernel.makeCompound([movedSolid!, solid!]);
        expect(kernel.subShapePosition(both, solid!)).toBe(1);
        expect(kernel.subShapePosition(both, movedSolid!)).toBe(0);
        expect(kernel.subShapePosition(plate, solid!)).toBe(0);
    });
});

/** A 3×4 row-major rigid transform: a turn about z by `angle`, then a move by `t`. */
function turnAndMove(angle: number, t: Vec3): number[] {
    const c = Math.cos(angle), s = Math.sin(angle);
    return [c, -s, 0, t.x, s, c, 0, t.y, 0, 0, 1, t.z];
}

function apply(m: readonly number[], p: Vec3): Vec3 {
    return {
        x: m[0]! * p.x + m[1]! * p.y + m[2]! * p.z + m[3]!,
        y: m[4]! * p.x + m[5]! * p.y + m[6]! * p.z + m[7]!,
        z: m[8]! * p.x + m[9]! * p.y + m[10]! * p.z + m[11]!,
    };
}

describe("B5 moves by position", () => {
    const axis = { point: { x: 10, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } };
    const quarter = Math.PI / 2;
    const moves = [
        {
            name: "translate",
            matrix: turnAndMove(0, { x: 5, y: -7, z: 3 }),
            ours: (s: ShapeHandle) => kernel.translateWithPositions(s, 5, -7, 3),
            theirs: (s: ShapeHandle) => kernel.translate(s, 5, -7, 3),
            history: (s: ShapeHandle, h: number[]) => kernel.translateWithHistory(s, 5, -7, 3, h, BOUND),
        },
        {
            name: "rotate",
            matrix: turnAndMove(quarter, { x: 10, y: -10, z: 0 }),
            ours: (s: ShapeHandle) => kernel.rotateWithPositions(s, axis, quarter),
            theirs: (s: ShapeHandle) => kernel.rotate(s, axis, quarter),
            history: (s: ShapeHandle, h: number[]) => kernel.rotateWithHistory(s, axis, quarter, h, BOUND),
        },
        {
            name: "mirror",
            matrix: [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
            ours: (s: ShapeHandle) => kernel.mirrorWithPositions(s, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }),
            theirs: (s: ShapeHandle) => kernel.mirror(s, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }),
            history: (s: ShapeHandle, h: number[]) =>
                kernel.mirrorWithHistory(s, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, h, BOUND),
        },
        {
            name: "transform",
            matrix: turnAndMove(0.3, { x: -4, y: 8, z: 12 }),
            ours: (s: ShapeHandle) => kernel.transformWithPositions(s, turnAndMove(0.3, { x: -4, y: 8, z: 12 })),
            theirs: (s: ShapeHandle) => kernel.transform(s, turnAndMove(0.3, { x: -4, y: 8, z: 12 })),
            history: null,
        },
    ];

    for (const move of moves) {
        it(`${move.name}: each sub-shape's position maps to where its image lies`, () => {
            const plate = plateWith(3);
            const moved = move.ours(plate);
            // The copy itself is upstream's, byte for byte.
            expect(kernel.toBREPBinary(moved.result)).toEqual(kernel.toBREPBinary(move.theirs(plate)));
            for (const kind of KINDS) {
                const map = kind === "face" ? moved.faces : kind === "edge" ? moved.edges : moved.vertices;
                const images = places(moved.result, kind);
                const sources = places(plate, kind);
                expect(map.length).toBe(sources.length);
                expect([...map].sort((a, b) => a - b)).toEqual(sources.map((_, i) => i));
                sources.forEach((source, p) =>
                    expect(nearest(apply(move.matrix, source), images, 1e-6, 1), `${kind} ${p}`).toBe(map[p]));
            }
            if (move.history) {
                // Upstream's history of the same move, by number on distinct numbers, paired
                // with ours by where each face lies.
                const hashes = kernel.subShapeHashes(plate, "face", BOUND);
                expectDistinct(hashes);
                const evo = move.history(plate, hashes);
                const theirResult = kernel.subShapeHashes(evo.result, "face", BOUND);
                expectDistinct(theirResult);
                const ours = places(moved.result, "face");
                const toOurs = places(evo.result, "face").map((p) => nearest(p, ours, 1e-6, 1));
                const images = runs(evo.modified);
                hashes.forEach((h, p) =>
                    expect(images.get(h)?.map((i) => toOurs[theirResult.indexOf(i)]), `face ${p}`).toEqual([moved.faces[p]]));
            }
        });
    }
});

describe("B6 the binary BREP round trip (a pin: positions survive it, no call changes)", () => {
    it("reads every list back in the order it was written", () => {
        const plate = plateWith(3);
        const back = kernel.fromBREPBinary(kernel.toBREPBinary(plate));
        expect(kernel.isSame(back, plate)).toBe(false);
        for (const kind of KINDS) {
            const before = places(plate, kind);
            const after = places(back, kind);
            expect(after.length).toBe(before.length);
            before.forEach((p, i) => expect(nearest(p, after, 1e-9, 1), `${kind} ${i}`).toBe(i));
        }
    });
});
