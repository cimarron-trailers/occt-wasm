// SPDX-License-Identifier: MIT OR Apache-2.0
// SPDX-FileCopyrightText: Cimarron Trailers
//
// Readies ts/ for `npm pack` of the cimarron-trailers fork's npm package
// (.github/workflows/fork-release.yml): the package declares what it holds and
// carries, beside the wasm, the license texts and the source of the tag it is
// built from.
//
//   node scripts/fork-pack.mjs <tag> <repository-url>
//   node scripts/fork-pack.mjs v5.6.0-cim.1 https://github.com/cimarron-trailers/occt-wasm
//
// Into ts/, the package's root, it copies upstream's LICENSE-MIT and the
// Apache-2.0 text (its tooling and TypeScript are MIT OR Apache-2.0) and the
// occt submodule's LICENSE_LGPL_21.txt and OCCT_LGPL_EXCEPTION.txt (the compiled
// wasm is OCCT, LGPL-2.1-only), and writes SOURCE.txt, which names the tag. It
// sets ts/package.json's version (the tag's), license, files and repository.
// Nothing is written by hand: every text is copied from the tagged tree or read
// from git, and the script refuses a tree that is not the tag's.

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ts = join(root, "ts");

const LICENSE = "(MIT OR Apache-2.0) AND LGPL-2.1-only";

/** Each file the package carries beside dist/, from where in the tagged tree.
 *  ⚠ The Apache-2.0 text is the fork's own canonical copy (LICENSES/Apache-2.0.txt, sha256
 *  cfc7749b…3d30): upstream's LICENSE-APACHE is a placeholder that omits the license. */
const CARRIED = [
    { to: "LICENSE-MIT", from: "LICENSE-MIT" },
    { to: "LICENSE-APACHE", from: "LICENSES/Apache-2.0.txt" },
    { to: "LICENSE-LGPL-2.1", from: "occt/LICENSE_LGPL_21.txt" },
    { to: "OCCT_LGPL_EXCEPTION.txt", from: "occt/OCCT_LGPL_EXCEPTION.txt" },
];
const SOURCE = "SOURCE.txt";

function fail(message) {
    console.error(`fork-pack: ${message}`);
    process.exit(1);
}

function git(...args) {
    try {
        return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    } catch (e) {
        fail(`git ${args.join(" ")} failed: ${String(e.stderr ?? e.message).trim()}`);
    }
}

const [tag, repository] = process.argv.slice(2);
const match = /^v(\d+\.\d+\.\d+)-cim\.[1-9]\d*$/.exec(tag ?? "");
if (!match) fail(`the tag must be vX.Y.Z-cim.N, naming upstream's version and the fork's revision; got ${tag}`);
if (!/^https:\/\/[^\s/]+\/[\w.-]+\/[\w.-]+$/.test(repository ?? "")) {
    fail(`the repository must be its https URL, e.g. https://github.com/owner/name; got ${repository}`);
}
const upstreamVersion = match[1];
const version = tag.slice(1);

// The tree must be the tag's: its commit, and its occt submodule at the commit it pins.
const commit = git("rev-parse", "HEAD");
if (git("rev-parse", `${tag}^{commit}`) !== commit) fail(`HEAD is not ${tag}`);
// A build leaves untracked output (dist/, occt/build/), never a changed tracked file.
if (git("status", "--porcelain", "--untracked-files=no", "--ignore-submodules=untracked") !== "") {
    fail("the tracked tree differs from the tag");
}
const pinned = /^160000 commit ([0-9a-f]{40})\tocct$/.exec(git("ls-tree", "HEAD", "occt"))?.[1];
if (!pinned) fail("the tag pins no occt submodule commit");
if (git("-C", "occt", "rev-parse", "HEAD") !== pinned) fail(`occt is not checked out at ${pinned}`);
const occtUrl = git("config", "-f", ".gitmodules", "submodule.occt.url");
const occtCmake = readFileSync(join(root, "occt/adm/cmake/version.cmake"), "utf8");
const occtVersion = ["MAJOR", "MINOR", "MAINTENANCE"]
    .map((part) => new RegExp(`set \\(OCC_VERSION_${part}\\s+(\\d+)\\s*\\)`).exec(occtCmake)?.[1])
    .join(".");
if (!/^\d+\.\d+\.\d+$/.test(occtVersion)) fail("cannot read OCCT's version from occt/adm/cmake/version.cmake");

const pkgPath = join(ts, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
if (pkg.version !== upstreamVersion) {
    fail(`${tag} names upstream ${upstreamVersion}, but ts/package.json is ${pkg.version}`);
}
if (!existsSync(join(ts, "dist", "occt-wasm.wasm"))) fail("ts/dist/occt-wasm.wasm is missing: build first");

for (const { to, from } of CARRIED) {
    const source = join(root, from);
    if (!existsSync(source) || statSync(source).size === 0) fail(`${from} is missing or empty`);
    copyFileSync(source, join(ts, to));
}

const tree = `${repository}/tree/${tag}`;
writeFileSync(join(ts, SOURCE), `occt-wasm ${version}: the cimarron-trailers fork of occt-wasm, built from
upstream occt-wasm ${upstreamVersion} (https://github.com/andymai/occt-wasm).

Its TypeScript and tooling are licensed MIT OR Apache-2.0 (LICENSE-MIT,
LICENSE-APACHE). The compiled occt-wasm.wasm contains Open CASCADE Technology
(OCCT) ${occtVersion}, licensed under the GNU Lesser General Public License version 2.1
(LICENSE-LGPL-2.1) with the Open CASCADE exception (OCCT_LGPL_EXCEPTION.txt).

The source of this package, OCCT's among it, is the tag it was built from:

  ${tree}
  (commit ${commit})

  git clone --recurse-submodules --branch ${tag} ${repository}.git

OCCT is that tag's occt submodule: ${occtUrl.replace(/\.git$/, "")} at commit ${pinned}.
`);

pkg.version = version;
pkg.license = LICENSE;
pkg.files = [...new Set([...(pkg.files ?? []), ...CARRIED.map(({ to }) => to), SOURCE])];
pkg.repository = { type: "git", url: `git+${repository}.git`, directory: "ts" };
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

console.log(`fork-pack: ts/ is occt-wasm ${version} (${LICENSE}), built from ${tree} (${commit})`);
