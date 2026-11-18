"""Build a VSIX with Python's standard library: python3 scripts/package.py."""
import json
from pathlib import Path
from xml.sax.saxutils import escape
from zipfile import ZIP_DEFLATED, ZipFile

root = Path(__file__).resolve().parents[1]
package = json.loads((root / "package.json").read_text())
def xml(value):
    return escape(value, {'"': '&quot;'})

manifest = '''<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
<Metadata><Identity Language="en-US" Id="{name}" Version="{version}" Publisher="{publisher}"/>
<DisplayName>{displayName}</DisplayName><Description xml:space="preserve">{description}</Description>
<Categories>Other</Categories><Properties>
<Property Id="Microsoft.VisualStudio.Code.Engine" Value="{engine}"/>
<Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="ui"/>
</Properties></Metadata>
<Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation><Dependencies/>
<Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/>
<Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true"/></Assets>
</PackageManifest>'''.format(**{k: xml(package[k]) for k in (
    "name", "version", "publisher", "displayName", "description")},
    engine=xml(package["engines"]["vscode"]))

types = '''<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="json" ContentType="application/json"/>
<Default Extension="js" ContentType="application/javascript"/>
<Default Extension="py" ContentType="text/plain"/>
<Default Extension="md" ContentType="text/markdown"/>
<Default Extension="vsixmanifest" ContentType="text/xml"/>
</Types>'''

target = root / "dist" / (package["name"] + "-" + package["version"] + ".vsix")
target.parent.mkdir(exist_ok=True)
with ZipFile(target, "w", ZIP_DEFLATED) as archive:
    archive.writestr("extension.vsixmanifest", manifest)
    archive.writestr("[Content_Types].xml", types)
    for name in ("package.json", "README.md", "extension.js", "transport.js", "remote.py"):
        archive.write(root / name, "extension/" + name)
print(target)
