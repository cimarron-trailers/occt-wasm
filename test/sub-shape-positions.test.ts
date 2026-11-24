/**
 * Sub-shapes named by position: a sub-shape's 0-based index in the order
 * getSubShapes returns its kind, which no two sub-shapes of a shape share.
 * Every position comes from one topology index per stored shape, built on first
 * use and freed with the shape. On a plate with holes:
 * - meshShape's and wireframe's groups name their face's or edge's position
 *   beside its hash;
 * - adjacencyByPosition says what each face's own sub-shapes and the shape's say;
 * - subShapePosition and subShapePositionsOf are where isSame finds a sub-shape;
 * - history, lookups and listings read the same index, which survives the arena
 *   growing and is freed by every path that removes its shape.
 *
 * Every oracle is independent of the call under test: isSame over handles, the
 * geometry, or the calls by hash on a shape whose hashes are first checked
 * distinct (where every hash in a list differs, a hash names one sub-shape).
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { EdgeData, Mesh, OcctKernel, ShapeHandle, Vec3 } from "../ts/src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

let kernel: OcctKernel;

beforeAll(async () => {
    const jsPath = resolve(__dirname, "../dist/occt-wasm.js");
    const wasmPath = resolve(__dirname, "../dist/occt-wasm.wasm");
    const createModule = (await import(jsPath)).default;
    const Module = await createModule({
        locateFile: (path: string) => (path.endsWith(".wasm") ? wasmPath : path),
    });
    const mod = await import(resolve(__dirname, "../ts/src/index.ts"));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    kernel = new (mod.OcctKernel as any)(Module);
}, 30_000);

afterEach(() => kernel.releaseAll());
afterAll(() => kernel[Symbol.dispose]());

/** The bound meshShape's and wireframe's group hashes are taken with. */
const BOUND = 2_147_483_647;

type Kind = "face" | "edge" | "vertex";
const KINDS: readonly Kind[] = ["face", "edge", "vertex"];

/** Three through holes of distinct radii at distinct places: no two faces share a centre. */
const HOLES: readonly [number, number, number][] = [
    [20, 20, 4],
    [50, 35, 6],
    [80, 22, 3],
];

/** A 100 × 60 × 10 plate with the {@link HOLES} through it. */
function plate(): ShapeHandle {
    let shape = kernel.makeBox(100, 60, 10);
    for (const [x, y, r] of HOLES) shape = kernel.cut(shape, kernel.translate(kernel.makeCylinder(r, 30), x, y, -10));
    return shape;
}

function dist(a: Vec3, b: Vec3): number {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Where each sub-shape of `kind` is: a face's centre of area, an edge's of length, a vertex's point. */
function places(shape: ShapeHandle, kind: Kind): Vec3[] {
    return kernel
        .getSubShapes(shape, kind)
        .map((s) =>
            kind === "face"
                ? kernel.getSurfaceCenterOfMass(s)
                : kind === "edge"
                  ? kernel.getLinearCenterOfMass(s)
                  : kernel.vertexPosition(s),
        );
}

/** The one index of `among` within `tol` of `p`, every other at least `gap` away, so never a near tie. */
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

/** A mesh group's centre of area, `[start, count]` into `indices`. */
function meshCentroid(mesh: Mesh, start: number, count: number): Vec3 {
    const p = mesh.positions;
    let ax = 0;
    let ay = 0;
    let az = 0;
    let total = 0;
    for (let t = start; t < start + count; t += 3) {
        const [a, b, c] = [mesh.indices[t]! * 3, mesh.indices[t + 1]! * 3, mesh.indices[t + 2]! * 3];
        const u = [p[b]! - p[a]!, p[b + 1]! - p[a + 1]!, p[b + 2]! - p[a + 2]!];
        const v = [p[c]! - p[a]!, p[c + 1]! - p[a + 1]!, p[c + 2]! - p[a + 2]!];
        const area =
            Math.hypot(u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!) / 2;
        ax += (area * (p[a]! + p[b]! + p[c]!)) / 3;
        ay += (area * (p[a + 1]! + p[b + 1]! + p[c + 1]!)) / 3;
        az += (area * (p[a + 2]! + p[b + 2]! + p[c + 2]!)) / 3;
        total += area;
    }
    return { x: ax / total, y: ay / total, z: az / total };
}

/** A wireframe group's centre of length, `[start, count]` into `points` (floats). */
function polylineCentroid(edges: EdgeData, start: number, count: number): Vec3 {
    const p = edges.points;
    let ax = 0;
    let ay = 0;
    let az = 0;
    let total = 0;
    for (let i = start; i + 5 < start + count; i += 3) {
        const len = Math.hypot(p[i + 3]! - p[i]!, p[i + 4]! - p[i + 1]!, p[i + 5]! - p[i + 2]!);
        ax += (len * (p[i]! + p[i + 3]!)) / 2;
        ay += (len * (p[i + 1]! + p[i + 4]!)) / 2;
        az += (len * (p[i + 2]! + p[i + 5]!)) / 2;
        total += len;
    }
    return { x: ax / total, y: ay / total, z: az / total };
}

function triples(groups: Int32Array): [number, number, number][] {
    const out: [number, number, number][] = [];
    for (let g = 0; g + 2 < groups.length; g += 3) out.push([groups[g]!, groups[g + 1]!, groups[g + 2]!]);
    return out;
}

/** `sub`'s position among `list` by isSame alone, or -1. */
function bySame(sub: ShapeHandle, list: readonly ShapeHandle[]): number {
    const found = list.flatMap((s, i) => (kernel.isSame(s, sub) ? [i] : []));
    expect(found.length).toBeLessThanOrEqual(1);
    return found[0] ?? -1;
}

describe("mesh and wireframe groups by position", () => {
    it("each face group names its face's position beside its hash", () => {
        const shape = plate();
        const mesh = kernel.meshShape(shape);
        const groups = triples(mesh.faceGroups!);
        const positions = Array.from(mesh.facePositions!);
        expect(positions).toHaveLength(groups.length);

        const hashes = kernel.subShapeHashes(shape, "face", BOUND);
        expectDistinct(hashes);
        const centres = places(shape, "face");
        groups.forEach(([start, count, hash], g) => {
            expect(hashes[positions[g]!], `group ${g}`).toBe(hash);
            expect(nearest(meshCentroid(mesh, start, count), centres, 0.25, 2), `group ${g}`).toBe(positions[g]);
        });
        expect(new Set(positions).size).toBe(centres.length);
    });

    it("a face the mesher visits twice names its one position both times", () => {
        const face = kernel.getSubShapes(kernel.makeBox(10, 20, 30), "face")[2]!;
        const twice = kernel.makeCompound([face, face]);
        expect(kernel.getSubShapes(twice, "face")).toHaveLength(1);
        expect(Array.from(kernel.meshShape(twice).facePositions!)).toEqual([0, 0]);
    });

    it("each edge group names its edge's position beside its hash", () => {
        const shape = plate();
        for (const source of ["curve", "triangulation"] as const) {
            if (source === "triangulation") kernel.meshShape(shape);
            const edges = kernel.wireframe(shape, { deflection: 0.1, source });
            const groups = triples(edges.edgeGroups);
            const positions = Array.from(edges.edgePositions);
            expect(positions).toHaveLength(groups.length);

            const hashes = kernel.subShapeHashes(shape, "edge", BOUND);
            expectDistinct(hashes);
            const centres = places(shape, "edge");
            groups.forEach(([start, count, hash], g) => {
                expect(hashes[positions[g]!], `${source} group ${g}`).toBe(hash);
                expect(nearest(polylineCentroid(edges, start, count), centres, 0.25, 2), `${source} group ${g}`).toBe(
                    positions[g],
                );
            });
        }
    });

    it("an edge the wireframe skips leaves its position unnamed and the others' unchanged", () => {
        // A sphere's poles are degenerate edges, which the wireframe does not draw.
        const sphere = kernel.makeSphere(10);
        const edges = kernel.getSubShapes(sphere, "edge");
        const drawn = kernel.wireframe(sphere);
        const positions = Array.from(drawn.edgePositions);
        expect(positions.length).toBeLessThan(edges.length);
        const hashes = kernel.subShapeHashes(sphere, "edge", BOUND);
        expectDistinct(hashes);
        expect(positions.map((p) => hashes[p])).toEqual(triples(drawn.edgeGroups).map(([, , hash]) => hash));
        // A drawn edge comes after a skipped one, so a group's index is not its position.
        expect(positions).not.toEqual(positions.map((_, g) => g));
    });
});

describe("adjacencyByPosition", () => {
    it("says what each face's own sub-shapes and the shape's say, by isSame", () => {
        const shape = plate();
        const adjacency = kernel.adjacencyByPosition(shape);
        const faces = kernel.getSubShapes(shape, "face");
        const edges = kernel.getSubShapes(shape, "edge");
        const vertices = kernel.getSubShapes(shape, "vertex");
        const faceEdges = faces.map((f) => kernel.getSubShapes(f, "edge").map((e) => bySame(e, edges)));
        const faceVertices = faces.map((f) => kernel.getSubShapes(f, "vertex").map((v) => bySame(v, vertices)));
        expect(faceEdges.flat()).not.toContain(-1);
        expect(adjacency.faceEdges).toEqual(faceEdges);
        expect(adjacency.faceVertices).toEqual(faceVertices);
        expect(adjacency.edgeFaces).toEqual(edges.map((_, e) => faceEdges.flatMap((own, f) => (own.includes(e) ? [f] : []))));
        // A hole's seam bounds its wall once, though the wall's wire runs along it twice.
        expect(adjacency.faceEdges.filter((own) => own.length === 3)).toHaveLength(HOLES.length);
    });

    it("each edge's faces are edgeToFaceMap's, on a shape whose hashes are distinct", () => {
        const shape = plate();
        const adjacency = kernel.adjacencyByPosition(shape);
        const faceHashes = kernel.subShapeHashes(shape, "face", BOUND);
        const edgeHashes = kernel.subShapeHashes(shape, "edge", BOUND);
        expectDistinct(faceHashes);
        expectDistinct(edgeHashes);
        const map = kernel.edgeToFaceMap(shape, BOUND);
        const byHash = new Map<number, number[]>();
        for (let i = 0; i < map.length; ) {
            const n = map[i + 1]!;
            byHash.set(
                edgeHashes.indexOf(map[i]!),
                map.slice(i + 2, i + 2 + n).map((h) => faceHashes.indexOf(h)),
            );
            i += 2 + n;
        }
        adjacency.edgeFaces.forEach((faces, e) => {
            expect([...new Set(byHash.get(e) ?? [])].sort((a, b) => a - b), `edge ${e}`).toEqual(faces);
        });
    });
});

describe("lookups by position", () => {
    it("subShapePosition is where isSame finds the sub-shape among the shape's, or null", () => {
        const shape = plate();
        for (const kind of KINDS) {
            kernel.getSubShapes(shape, kind).forEach((sub, i) => expect(kernel.subShapePosition(shape, sub)).toBe(i));
        }
        // A copy, or the same topology placed elsewhere, is another shape: in no list of this one.
        const moved = kernel.translate(shape, 0, 0, 50);
        const placed = kernel.located(shape, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 50]);
        for (const other of [moved, placed]) {
            for (const kind of KINDS) {
                for (const sub of kernel.getSubShapes(other, kind)) expect(kernel.subShapePosition(shape, sub)).toBeNull();
            }
        }
        const [solid] = kernel.getSubShapes(shape, "solid");
        const [movedSolid] = kernel.getSubShapes(moved, "solid");
        const both = kernel.makeCompound([movedSolid!, solid!]);
        expect(kernel.subShapePosition(both, solid!)).toBe(1);
        expect(kernel.subShapePosition(both, movedSolid!)).toBe(0);
    });

    it("subShapePositionsOf maps a piece of a cut into the result, as isSame would", () => {
        // A slab through the plate leaves it in two pieces, held by one result.
        const slab = kernel.translate(kernel.makeBox(4, 80, 30), 60, -10, -10);
        const result = kernel.cut(plate(), slab);
        const pieces = kernel.getSubShapes(result, "solid");
        expect(pieces).toHaveLength(2);
        const all = (kind: Kind) => kernel.getSubShapes(result, kind);
        for (const piece of pieces) {
            const mapped = kernel.subShapePositionsOf(result, piece);
            expect(mapped).toEqual({
                faces: kernel.getSubShapes(piece, "face").map((s) => bySame(s, all("face"))),
                edges: kernel.getSubShapes(piece, "edge").map((s) => bySame(s, all("edge"))),
                vertices: kernel.getSubShapes(piece, "vertex").map((s) => bySame(s, all("vertex"))),
            });
            expect([...mapped.faces, ...mapped.edges, ...mapped.vertices]).not.toContain(-1);
        }
    });

    it("subShapePositionsOf names nothing of a copy, and a shape itself position for position", () => {
        const shape = plate();
        const copy = kernel.subShapePositionsOf(shape, kernel.translate(shape, 0, 0, 50));
        expect([...copy.faces, ...copy.edges, ...copy.vertices].every((p) => p === -1)).toBe(true);
        const self = kernel.subShapePositionsOf(shape, shape);
        expect(self.faces).toEqual(self.faces.map((_, i) => i));
        expect(self.edges).toEqual(self.edges.map((_, i) => i));
        expect(self.vertices).toEqual(self.vertices.map((_, i) => i));
    });
});

describe("one topology index per stored shape", () => {
    it("is built on first use and read by history, lookups and listings alike", () => {
        const base = kernel.makeBox(10, 10, 10);
        const tool = kernel.translate(kernel.makeBox(10, 10, 10), 5, 5, 5);
        const before = kernel.topologyIndexCount;
        const hashes = [...kernel.subShapeHashes(base, "face", BOUND), ...kernel.subShapeHashes(tool, "face", BOUND)];
        expect(kernel.topologyIndexCount).toBe(before + 2);

        // The history builds the result's index; every later answer about the result reads it.
        const evo = kernel.cutWithHistory(base, tool, hashes, BOUND);
        const afterHistory = kernel.topologyIndexCount;
        expect(afterHistory).toBe(before + 3);
        const resultFaces = kernel.getSubShapes(evo.result, "face");
        const inputs = [base, tool];
        expect(evo.keptIndexed.length).toBeGreaterThan(0);
        for (let i = 0; i < evo.keptIndexed.length; i += 3) {
            const input = kernel.getSubShapes(inputs[evo.keptIndexed[i]!]!, "face")[evo.keptIndexed[i + 1]!]!;
            expect(kernel.subShapePosition(evo.result, input)).toBe(evo.keptIndexed[i + 2]);
            expect(kernel.isSame(resultFaces[evo.keptIndexed[i + 2]!]!, input)).toBe(true);
        }
        // Listing and looking up the result and its inputs built no second index of any of them.
        expect(kernel.topologyIndexCount).toBe(afterHistory);
    });

    it("survives the arena growing around it", () => {
        const shape = plate();
        const faces = kernel.getSubShapes(shape, "face");
        expect(kernel.subShapePosition(shape, faces[3]!)).toBe(3);
        for (let i = 0; i < 2000; i++) kernel.makeBox(1, 1, 1);
        faces.forEach((face, i) => expect(kernel.subShapePosition(shape, face)).toBe(i));
        expect(Array.from(kernel.meshShape(shape).facePositions!).sort((a, b) => a - b)).toEqual(faces.map((_, i) => i));
    });

    it("is freed by release, releaseSince and releaseAll", () => {
        const kept = kernel.makeBox(1, 2, 3);
        kernel.subShapeCount(kept, "face");
        const base = kernel.topologyIndexCount;

        const one = kernel.makeBox(4, 5, 6);
        kernel.adjacencyByPosition(one);
        expect(kernel.topologyIndexCount).toBe(base + 1);
        kernel.adjacencyByPosition(one);
        expect(kernel.topologyIndexCount).toBe(base + 1);
        kernel.release(one);
        expect(kernel.topologyIndexCount).toBe(base);

        const mark = kernel.checkpoint();
        for (let i = 0; i < 3; i++) kernel.meshShape(kernel.makeBox(1 + i, 1, 1));
        expect(kernel.topologyIndexCount).toBe(base + 3);
        kernel.releaseSince(mark);
        expect(kernel.topologyIndexCount).toBe(base);

        kernel.releaseAll();
        expect(kernel.topologyIndexCount).toBe(0);
        expect(kernel.shapeCount).toBe(0);
    });

    it("is freed with a result an operation stores and then abandons", () => {
        // With a hash bound of 0 the extrude stores its result and indexes it for the
        // history, then refuses the bound: the abandoned result and its index both go.
        const face = kernel.getSubShapes(kernel.makeBox(4, 3, 2), "face")[0]!;
        const shapes = kernel.shapeCount;
        const indexes = kernel.topologyIndexCount;
        expect(() => kernel.extrudeWithHistory(face, 0, 0, 5, [], 0)).toThrow();
        expect(kernel.shapeCount).toBe(shapes);
        expect(kernel.topologyIndexCount).toBe(indexes);
    });
});
