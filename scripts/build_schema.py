import json, re, sys
d=json.load(open('schema_raw.json',encoding='utf-8'))
TR=json.load(open('zh_en.json',encoding='utf-8'))
zh=re.compile(r'[一-鿿]')
missing=set()
def tr(s):
    if not isinstance(s,str) or not zh.search(s): return s
    if s in TR: return TR[s]
    missing.add(s); return s

HUBS=['variableMissionListingServer','missionHubServer','DHSDaemon']
def js_override(node, f):
    n=f.get('name'); nn=node['name']
    if nn=='Computer' and n=='id':
        return {'hint':'text','suggest':[
          {'value':'playerComp','desc':"Replaces the player's own computer"},
          {'value':'ispComp','desc':'ISP server (needs an ispSystem daemon)'},
          {'value':'jmail','desc':'Replaces the JMail server (needs a mailServer + player mail account)'},
          {'value':'academic','desc':'Academic server (used by AddDegree / wipedegrees goals)'},
          {'value':'deathRow','desc':'Death row database (used by death row goals)'}]}
    if n in ('ip','NewIP') and nn in ('Computer','ConditionalActions.*.ChangeIP|CustomFaction.Action.ChangeIP'):
        return {'hint':'ip'}
    if n=='ip' or nn.endswith('SourceIP') or nn.endswith('AgentDetails.IP'):
        return {'hint':'computerip'}
    if n in ('AdminEmailHostID','mailServer'):
        return {'hint':'computer','compFilter':['mailServer'],'extra':['jmail']}
    if n=='TargetComp' and ('MissionToHubServer' in nn or 'MissionFromHubServer' in nn):
        return {'hint':'computer','compFilter':HUBS}
    if n=='TargetComp' and 'AddThreadToMissionBoard' in nn:
        return {'hint':'computer','compFilter':['messageBoard']}
    if n=='TargetComp' and 'AddIRCMessage' in nn:
        return {'hint':'computer','compFilter':['IRCDaemon','DHSDaemon']}
    if n=='AssignmentTag':
        return {'hint':'compchild','from':'TargetComp','child':['agent','user'],'childAttr':'name','extra':['top']}
    if n=='Author':
        return {'hint':'compchild','from':'TargetComp','child':['user','agent'],'childAttr':'name'}
    if n=='Username' and 'GivePlayerUserAccount' in nn:
        return {'hint':'compchild','from':'TargetComp','child':['account'],'childAttr':'username'}
    if nn=='mission.email.attachments.account' and n=='user':
        return {'hint':'compchild','from':'comp','child':['account'],'childAttr':'username'}
    if nn=='mission.email.attachments.account' and n=='pass':
        return {'hint':'compchild','from':'comp','child':['account'],'childAttr':'password','matchAttr':'user','matchChildAttr':'username'}
    if n=='recipient' and nn=='mission.goals.goal':
        return {'hint':'compchild','from':'mailServer','child':['account'],'childAttr':'username'}
    if n=='ThemePathOrName':
        return {'hint':'themefile','enums':[{'value':t,'desc':'Built-in theme'} for t in ['TerminalOnlyBlack','HacknetBlue','HacknetTeal','HacknetYellow','HacknetWhite','HacknetPurple','HacknetMint','HackerGreen']]}
    if n=='Target' and 'ChangeAlertIcon' in nn:
        return {'hint':'computeroreos','extra':['jmail']}
    if n=='comp' and nn=='mission.goals.goal':
        return {'hint':'computer','compFilter':['DatabaseDaemon']}
    if n=='FunctionValue': return {'hint':'text'}
    return {'hint':'text'}

FLAGNAMES={'requiredFlags','reqs','Flags','SequencerFlagRequiredForStart'}
def fix_field(node,f):
    f=dict(f)
    for k in ('desc','default'): 
        if k in f: f[k]=tr(f[k])
    if 'enums' in f: f['enums']=[{'value':e['value'],'desc':tr(e['desc'])} for e in f['enums']]
    if 'steps' in f:
        st=[]
        for s in f['steps']:
            s=dict(s); s['desc']=tr(s['desc'])
            if 'next' in s:
                nx=s['next']
                if nx.get('hint')=='js': s['next']={'hint':'faction'}
                else: s['next']=fix_field(node,nx)
            st.append(s)
        f['steps']=st
    if f.get('hint')=='js':
        f.pop('js',None); f.update(js_override(node,f))
    f.pop('js',None)
    dr=f.pop('diagRule',None)
    if dr: 
        f['diag']=dr.get('type',f.get('diag','E'))
        if dr.get('ignoreCaseForEnum')=='true': f['ignoreCase']=True
    h=f.get('hint','enum')
    if h=='enum':
        vals=[e['value'].lower() for e in f.get('enums',[])]
        if vals and set(vals)<= {'true','false'}: f['hint']='bool'
        elif not f.get('enums'): f['hint']='text'
    if h=='enumwithcommonstring': f['hint']='text'; f['wildcards']=True
    if h=='misisonfile': f['hint']='missionfile'
    if f.get('name') in FLAGNAMES: f['hint']='flags'
    if f.get('name')=='DelayHost': f['compFilter']=['IRCDaemon','DHSDaemon','FastActionHost']
    if 'text' in f: f.pop('text')
    return f

nodes=[]
for n in d['nodes']:
    if not n.get('enable',True): continue
    m={'paths':[p.strip() for p in n['name'].split('|')],'multi':n['multi'],'desc':tr(n['desc'])}
    if 'filePattern' in n: m['filePattern']=n['filePattern']
    if n.get('container'): m['container']=True
    if 'content' in n: m['content']=fix_field(n,n['content'])
    m['attributes']=[fix_field(n,a) for a in n['attributes']]
    if 'conditions' in n:
        m['conditions']=[{'attr':c['attr'],'match':c['match'],'ignoreCase':c['ignoreCase'],'attributes':[fix_field(n,a) for a in c['attributes']]} for c in n['conditions']]
    nodes.append(m)

# special content tweaks
for m in nodes:
    p=m['paths'][0]
    if p=='mission.goals.goal':
        for c in m['conditions']:
            if c['match'].strip('^$').lower()=='hasflag':
                for a in c['attributes']:
                    if a['name']=='target': a['hint']='flags'
    if p=='HacknetExtension.StartingVisibleNodes':
        m['content']['hint']='computerlist'

out={'version':1,'source':'Derived from fengxu-30338/HacknetExtensionEditor (GPL-3.0), translated to English',
     'nodes':nodes,
     'wildcards':[{'value':t['value'],'desc':tr(t.get('desc',''))} for t in d['replaceText']],
     'commonText':[{'value':t['value'],'desc':tr(t.get('desc',''))} for t in d['commonText']],
     'hackerScript':[{'label':t['label'],'value':t['value'],'desc':tr(t.get('desc','')),'doc':tr(t.get('doc',''))} for t in d['hackerScript']]}
json.dump(out,open(sys.argv[1],'w',encoding='utf-8'),ensure_ascii=False,indent=1)
print('nodes',len(nodes),'missing',len(missing))
for s in list(missing)[:40]: print(' ',s)
