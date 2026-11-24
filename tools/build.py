from pathlib import Path
import json,zipfile,re,struct

root=Path(__file__).resolve().parent.parent
manifest=json.loads((root/'plugin.json').read_text(encoding='utf-8'))
name=manifest['name'];url=manifest['url']
if not re.fullmatch(r'https://github.com/[A-Za-z0-9-]+/'+re.escape(name),url):raise SystemExit('Set the exact GitHub owner and matching repository name first.')
if not re.fullmatch(r'\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?',manifest['version']):raise SystemExit('Invalid SemVer')
for field in ['displayName','description','readme']:
    if not manifest.get(field,{}).get('default'):raise SystemExit('Missing '+field+'.default')
    for locale in manifest[field]:
        if locale!='default' and not re.fullmatch(r'[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*',locale):raise SystemExit('Invalid locale '+locale)
for field,maximum in [('icon',64*1024),('preview',512*1024)]:
    path=root/manifest[field]
    if not path.is_file() or path.stat().st_size>maximum:raise SystemExit('Missing/oversized '+field)
    if path.read_bytes()[:8]!=b'\x89PNG\r\n\x1a\n':raise SystemExit('Expected PNG '+field)
dist=root/'dist';dist.mkdir(exist_ok=True)
files={
    'index.js':((root/'src/nav-core.js').read_text(encoding='utf-8')+'\n'+(root/'src/plugin-entry.js').read_text(encoding='utf-8')).encode(),
    'index.css':(root/'src/nav.css').read_bytes(),
}
for filename in ['plugin.json','README.md','README.zh-CN.md','LICENSE','CHANGELOG.md',manifest['icon'],manifest['preview']]:files[filename]=(root/filename).read_bytes()
for filename,data in files.items():(dist/filename).write_bytes(data)
release=root/'release';release.mkdir(exist_ok=True)
with zipfile.ZipFile(release/'package.zip','w',zipfile.ZIP_DEFLATED) as archive:
    for filename,data in files.items():archive.writestr(filename,data)
with zipfile.ZipFile(release/'package.zip') as archive:
    assert archive.testzip() is None
    assert json.loads(archive.read('plugin.json'))==manifest
    assert 'index.js' in archive.namelist() and not any(n.startswith('/')or'..'in n.split('/') for n in archive.namelist())
print('Built',release/'package.zip','with',len(files),'root files.')
