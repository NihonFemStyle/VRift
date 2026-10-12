import xml.etree.ElementTree as ET, json, re, sys
src = sys.argv[1]
raw = open(src, encoding='utf-8').read()
root = ET.fromstring(raw.encode('utf-8'))

def text_of(el):
    # direct text (not children)
    t = (el.text or '').strip()
    return t

def enums(el):
    out=[]
    e = el.find('Enums')
    if e is None: return out
    for en in e.findall('Enum'):
        out.append({'value': (en.text or '').strip(), 'desc': en.get('desc','')})
    return out

def steps(el):
    out=[]
    for st in el.findall('Step'):
        d={'value': st.get('value',''), 'desc': st.get('desc','')}
        nx = st.find('Next')
        if nx is not None:
            d['next'] = field(nx, nx.get('hint','enum'))
        out.append(d)
    return out

def field(el, hint=None):
    h = (hint or el.get('hint') or 'enum')
    f = {
        'name': el.get('name'),
        'required': el.get('required','false').lower()=='true',
        'default': el.get('default',''),
        'desc': el.get('desc',''),
        'hint': h.lower(),
    }
    if f['name'] is None: del f['name']
    if el.get('linkBy'): f['linkBy']=el.get('linkBy')
    if el.get('diag'): f['diag']=el.get('diag')
    ev = enums(el)
    if ev: f['enums']=ev
    sv = steps(el)
    if sv: f['steps']=sv
    lbc = el.find('LinkByCollection')
    if lbc is not None:
        f['linkByCollection']=[dict(i.attrib) for i in lbc.findall('Item')]
    dg = el.find('Diag')
    if dg is not None:
        f['diagRule']={k:v for k,v in dg.attrib.items()}
        if (dg.text or '').strip(): f['diagRule']['js']=dg.text.strip()
    t = text_of(el)
    if t:
        if f['hint'] in ('path','folder'): f['pattern']=t
        elif f['hint']=='js': f['js']=t
        else: f['text']=t
    return f

nodes=[]
for n in root.findall('Node'):
    name=n.get('name')
    if name.startswith('HacknetEditorHint'): continue
    nd={'name':name.strip(),'multi':n.get('multi')=='true','desc':n.get('desc',''),'enable':n.get('enable','true')=='true'}
    if n.get('fileTriggerPattern'): nd['filePattern']=n.get('fileTriggerPattern')
    c=n.find('Content')
    if c is not None:
        if c.attrib or (c.text or '').strip() or len(c):
            nd['content']=field(c)
        else:
            nd['container']=True
    nd['attributes']=[field(a) for a in n.findall('Attribute')]
    conds=[]
    for ca in n.findall('ConditionAttributes'):
        conds.append({'attr':ca.get('attr'),'match':ca.get('match'),'ignoreCase':ca.get('ignoreCase','false')=='true',
                      'attributes':[field(a) for a in ca.findall('Attribute')]})
    if conds: nd['conditions']=conds
    dyn=n.find('DynamicGenerateAttribute')
    if dyn is not None: nd['dynamicJs']=(dyn.text or '').strip()
    nodes.append(nd)

def texts(tag):
    el=root.find(tag)
    if el is None: return []
    return [dict(t.attrib) for t in el.findall('Text')]
out={'nodes':nodes,'replaceText':texts('ReplaceTextHint'),'commonText':texts('CommonTextHint'),'hackerScript':texts('HackerScriptsHint'),
     'includes':[i.get('path') for i in root.findall('Include')]}
json.dump(out, open('schema_raw.json','w',encoding='utf-8'), ensure_ascii=False, indent=1)
print(len(nodes), {k:len(v) for k,v in out.items()})
