from pathlib import Path
import argparse,json,re

root=Path(__file__).resolve().parent.parent
p=argparse.ArgumentParser(description='Set the public SiYuan repository identity.')
p.add_argument('--owner',required=True);p.add_argument('--repo',default='siyuan-auto-navigation');p.add_argument('--author')
args=p.parse_args()
if not re.fullmatch(r'[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?',args.owner):p.error('Invalid GitHub owner')
if not re.fullmatch(r'[A-Za-z0-9_.-]+',args.repo):p.error('Invalid repository name')
manifest=json.loads((root/'plugin.json').read_text(encoding='utf-8'))
manifest['name']=args.repo;manifest['url']=f'https://github.com/{args.owner}/{args.repo}'
if args.author:manifest['author']=args.author
(root/'plugin.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(manifest['url'])
