// SPDX-License-Identifier: MIT OR Apache-2.0
// SPDX-FileCopyrightText: Cimarron Trailers

//! The cimarron-trailers fork's XCAF methods: a third list, beside upstream's
//! [`super::config`] and the fork's sub-shape identity list ([`super::fork`]),
//! which the generator reads after both (`run.rs`).
//!
//! Upstream's `xcafAddComponent` recomputes every assembly in the document
//! (`UpdateAssemblies`) after each component it adds, so adding N components
//! takes time in the square of N; and `xcafExportSTEP` writes OCCT's default
//! unit, millimetres, whatever unit the shapes are in. These methods build an
//! assembly of any size, and write it in the unit its numbers are in:
//!
//! - `xcafNewAssembly` makes an empty assembly label;
//! - `xcafAddComponentAt` places a part or an assembly in an assembly by a
//!   rigid 3x4 matrix, refuses one that scales, shears or reflects, and leaves
//!   the assemblies to be updated once;
//! - `xcafExportSTEPInUnit` updates every assembly once, then writes the file
//!   in the unit it is given, which is also the unit the shapes are read in.
//!
//! Like the identity list, these are npm-only: emitted into the Embind build,
//! never into the WASI C-ABI or the Rust crate. Their TypeScript is
//! `XCAFDocument`'s `addAssembly`, `addComponentAt` and `exportSTEPInUnit`.

use super::types::{FacadeParam, MethodKind, MethodSpec, ReturnType};

/// The fork's XCAF methods, in the order the generator emits them.
static FORK_XCAF_METHODS: &[MethodSpec] = &[
    MethodSpec {
        name: "xcafNewAssembly",
        kind: MethodKind::CustomBody,
        params: &[FacadeParam::DocId("docId")],
        occt_class: "",
        ctor_args: "",
        // An empty top-level shape, marked an assembly, for `xcafAddComponentAt`.
        setup_code: "\
auto it = xcafDocs_.find(docId);
if (it == xcafDocs_.end())
    throw std::runtime_error(\"xcafNewAssembly: invalid document ID\");

Handle(XCAFDoc_ShapeTool) shapeTool =
    XCAFDoc_DocumentTool::ShapeTool(it->second.doc->Main());
TDF_Label label = shapeTool->NewShape();
TDataStd_UAttribute::Set(label, XCAFDoc::AssemblyGUID());
return registerLabel(it->second, label);",
        includes: &[
            "XCAFDoc.hxx",
            "XCAFDoc_ShapeTool.hxx",
            "XCAFDoc_DocumentTool.hxx",
            "TDataStd_UAttribute.hxx",
            "TDF_Label.hxx",
        ],
        category: "xcaf",
        return_type: ReturnType::Int,
    },
    MethodSpec {
        name: "xcafAddComponentAt",
        kind: MethodKind::CustomBody,
        params: &[
            FacadeParam::DocId("docId"),
            FacadeParam::Int("parentLabelId"),
            FacadeParam::Int("placedLabelId"),
            FacadeParam::Double("r00"),
            FacadeParam::Double("r01"),
            FacadeParam::Double("r02"),
            FacadeParam::Double("tx"),
            FacadeParam::Double("r10"),
            FacadeParam::Double("r11"),
            FacadeParam::Double("r12"),
            FacadeParam::Double("ty"),
            FacadeParam::Double("r20"),
            FacadeParam::Double("r21"),
            FacadeParam::Double("r22"),
            FacadeParam::Double("tz"),
        ],
        occt_class: "",
        ctor_args: "",
        // A placed reference to `placedLabelId`, so one part or sub-assembly placed
        // many times is written once. The matrix is the 3x4 row-major layout
        // `xcafGetLabelLocation` answers.
        setup_code: "\
auto it = xcafDocs_.find(docId);
if (it == xcafDocs_.end())
    throw std::runtime_error(\"xcafAddComponentAt: invalid document ID\");

Handle(XCAFDoc_ShapeTool) shapeTool =
    XCAFDoc_DocumentTool::ShapeTool(it->second.doc->Main());
TDF_Label parentLabel = lookupLabel(it->second.labelRegistry, parentLabelId);
TDF_Label placedLabel = lookupLabel(it->second.labelRegistry, placedLabelId);
if (!shapeTool->IsAssembly(parentLabel))
    throw std::runtime_error(\"xcafAddComponentAt: the parent must be an assembly\");
if (shapeTool->IsReference(placedLabel))
    throw std::runtime_error(
        \"xcafAddComponentAt: the placed label must be a part or an assembly, not a component\");
if (placedLabel == parentLabel)
    throw std::runtime_error(\"xcafAddComponentAt: an assembly cannot contain itself\");

// A STEP component's placement is rigid: a rotation and a translation. A matrix
// that scales, shears or reflects is refused here, never written as another.
const double r[3][3] = {{r00, r01, r02}, {r10, r11, r12}, {r20, r21, r22}};
for (int i = 0; i < 3; ++i) {
    for (int j = 0; j < 3; ++j) {
        const double dot = r[0][i] * r[0][j] + r[1][i] * r[1][j] + r[2][i] * r[2][j];
        if (std::abs(dot - (i == j ? 1.0 : 0.0)) > 1e-9)
            throw std::runtime_error(
                \"xcafAddComponentAt: the placement is not rigid: it scales or shears\");
    }
}
const double det = r00 * (r11 * r22 - r12 * r21) - r01 * (r10 * r22 - r12 * r20) +
                   r02 * (r10 * r21 - r11 * r20);
if (det < 0)
    throw std::runtime_error(
        \"xcafAddComponentAt: the placement reflects, and a component cannot be mirrored\");

gp_Trsf trsf;
trsf.SetValues(r00, r01, r02, tx, r10, r11, r12, ty, r20, r21, r22, tz);
TDF_Label compLabel = shapeTool->AddComponent(parentLabel, placedLabel, TopLoc_Location(trsf));
if (compLabel.IsNull())
    throw std::runtime_error(\"xcafAddComponentAt: the component was not added\");
// No UpdateAssemblies here: it recomputes every assembly in the document, so
// running it per component made adding N of them quadratic. The export runs it
// once, before it writes.
return registerLabel(it->second, compLabel);",
        includes: &[
            "XCAFDoc_ShapeTool.hxx",
            "XCAFDoc_DocumentTool.hxx",
            "TDF_Label.hxx",
            "TopLoc_Location.hxx",
            "gp_Trsf.hxx",
        ],
        category: "xcaf",
        return_type: ReturnType::Int,
    },
    MethodSpec {
        name: "xcafExportSTEPInUnit",
        kind: MethodKind::CustomBody,
        params: &[FacadeParam::DocId("docId"), FacadeParam::String("unit")],
        occt_class: "",
        ctor_args: "",
        // The shapes are read in `unit` (the document's length unit) and written in
        // it (the writer's WriteUnit), so the file declares the unit of the numbers
        // it holds and converts none of them. Both are set for this one write,
        // never in OCCT's process-wide statics, which upstream's export reads.
        setup_code: "\
auto it = xcafDocs_.find(docId);
if (it == xcafDocs_.end())
    throw std::runtime_error(\"xcafExportSTEPInUnit: invalid document ID\");

UnitsMethods_LengthUnit fileUnit;
double metresPerUnit;
if (unit == \"MM\") {
    fileUnit = UnitsMethods_LengthUnit_Millimeter;
    metresPerUnit = 0.001;
} else if (unit == \"CM\") {
    fileUnit = UnitsMethods_LengthUnit_Centimeter;
    metresPerUnit = 0.01;
} else if (unit == \"M\") {
    fileUnit = UnitsMethods_LengthUnit_Meter;
    metresPerUnit = 1.0;
} else if (unit == \"INCH\") {
    fileUnit = UnitsMethods_LengthUnit_Inch;
    metresPerUnit = 0.0254;
} else if (unit == \"FT\") {
    fileUnit = UnitsMethods_LengthUnit_Foot;
    metresPerUnit = 0.3048;
} else {
    throw std::runtime_error(\"xcafExportSTEPInUnit: unknown unit '\" + unit +
                             \"': MM, CM, M, INCH or FT\");
}

Handle(XCAFDoc_ShapeTool) shapeTool =
    XCAFDoc_DocumentTool::ShapeTool(it->second.doc->Main());
// Once, for every component xcafAddComponentAt added.
shapeTool->UpdateAssemblies();
XCAFDoc_DocumentTool::SetLengthUnit(it->second.doc, metresPerUnit);

// The writer first: making it initialises OCCT's STEP statics, which the
// parameters are read from. Read before it, on a module's first export, they
// were unset, and every placement of a part was written as a part of its own.
STEPCAFControl_Writer writer;
DESTEP_Parameters params;
params.InitFromStatic();
params.WriteUnit = fileUnit;

writer.SetColorMode(Standard_True);
writer.SetNameMode(Standard_True);
// As upstream's xcafExportSTEP: without DirectFaces a cone's lateral faces are
// dropped from the output.
ShapeProcess::OperationsFlags spFlags;
spFlags.set(ShapeProcess::Operation::DirectFaces);
spFlags.set(ShapeProcess::Operation::SplitCommonVertex);
writer.SetShapeProcessFlags(spFlags);

if (!writer.Transfer(it->second.doc, params, STEPControl_AsIs))
    throw std::runtime_error(\"xcafExportSTEPInUnit: transfer failed\");

std::string tmpPath = \"/tmp/xcaf_export_in_unit.step\";
if (writer.Write(tmpPath.c_str()) != IFSelect_RetDone)
    throw std::runtime_error(\"xcafExportSTEPInUnit: write failed\");

std::ifstream ifs(tmpPath);
std::string content((std::istreambuf_iterator<char>(ifs)), std::istreambuf_iterator<char>());
std::remove(tmpPath.c_str());
return content;",
        includes: &[
            "STEPCAFControl_Writer.hxx",
            "STEPControl_StepModelType.hxx",
            "DESTEP_Parameters.hxx",
            "UnitsMethods_LengthUnit.hxx",
            "XCAFDoc_DocumentTool.hxx",
            "XCAFDoc_ShapeTool.hxx",
            "ShapeProcess.hxx",
            "Standard_Failure.hxx",
        ],
        category: "xcaf",
        return_type: ReturnType::String,
    },
];

/// The fork's XCAF method specifications, which the generator reads after
/// upstream's [`super::config::target_methods`] and the identity list's
/// [`super::fork::target_methods`].
pub fn target_methods() -> &'static [MethodSpec] {
    FORK_XCAF_METHODS
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::codegen::{config, fork};

    #[test]
    fn all_three_lists_validate_together() {
        let all: Vec<MethodSpec> = config::target_methods()
            .iter()
            .chain(fork::target_methods())
            .chain(target_methods())
            .copied()
            .collect();
        assert!(
            config::validate(&all).is_ok(),
            "upstream + fork + fork XCAF specs failed validation: {:?}",
            config::validate(&all).err()
        );
    }

    #[test]
    fn fork_xcaf_methods_keep_to_their_own_category() {
        for m in target_methods() {
            assert_eq!(m.category, "xcaf", "{}", m.name);
            assert_ne!(m.kind, MethodKind::Skip, "{}", m.name);
        }
    }

    // The quadratic add is what this list exists to remove: a component added
    // never recomputes the assemblies, and the export does, once.
    #[test]
    fn assemblies_are_updated_once_by_the_export_never_per_component() {
        let by_name = |name: &str| {
            target_methods()
                .iter()
                .find(|m| m.name == name)
                .map_or("", |m| m.setup_code)
        };
        let add = by_name("xcafAddComponentAt");
        let export = by_name("xcafExportSTEPInUnit");
        assert!(!add.is_empty() && !export.is_empty());
        assert!(
            !add.contains("UpdateAssemblies()"),
            "xcafAddComponentAt must not update the assemblies"
        );
        assert!(
            export.contains("UpdateAssemblies()"),
            "xcafExportSTEPInUnit must update them before it writes"
        );
    }
}
