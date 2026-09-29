# Synthetic local provider for end-to-end transport/lifecycle verification.
# Never writes answers, account state, or credentials to its diagnostic log.
import json,os,sys,time,threading,signal
if sys.argv[1:]==['--version']:
 print('codex-cli 0.156.1');sys.exit(0)
if sys.argv[1:]!=['app-server']:
 print('unsupported fixture invocation');sys.exit(1)
lock=threading.Lock();state={};sid=os.environ['OPENADE_SESSION_ID'];thread='rpc-'+sid;counter=0
folder=os.path.join(os.environ['OPENADE_PROVIDER_HOME'],'rpc-log');os.makedirs(folder,exist_ok=True)
def emit(value):
 with lock: print(json.dumps(value),flush=True)
def note(value):
 with lock:
  with open(os.path.join(folder,sid+'.jsonl'),'a') as f:f.write(json.dumps(value)+'\n')
def result(frame,value):emit({'id':frame['id'],'result':value})
def notify(method,params):emit({'method':method,'params':params})
def complete(turn,text='Persistent native response'):
 if not state.get(turn,{}).get('active'):return
 state[turn]['active']=False
 notify('item/agentMessage/delta',{'threadId':thread,'turnId':turn,'itemId':'message','delta':text})
 notify('item/completed',{'threadId':thread,'turnId':turn,'item':{'id':'message','type':'agentMessage','text':text}})
 notify('thread/tokenUsage/updated',{'threadId':thread,'turnId':turn,'tokenUsage':{'last':{'totalTokens':32000,'inputTokens':31000,'outputTokens':1000},'modelContextWindow':128000}})
 notify('turn/completed',{'threadId':thread,'turn':{'id':turn,'status':'completed'}})
def work(turn,prompt):
 time.sleep(.15)
 if 'explode' in prompt:os._exit(7)
 if 'bad-json' in prompt:
  with lock:print('{invalid protocol',flush=True)
  return
 if 'context-window-only' in prompt:
  state[turn]['active']=False
  notify('thread/tokenUsage/updated',{'threadId':thread,'turnId':turn,'tokenUsage':{'last':{},'modelContextWindow':200000}})
  notify('turn/completed',{'threadId':thread,'turn':{'id':turn,'status':'completed'}})
  return
 if 'stream-visible-burst' in prompt:
  notify('item/agentMessage/delta',{'threadId':thread,'turnId':turn,'itemId':'message','delta':'Live stream '+('chunk '*1800)+'FIRST_CHUNK_END'})
  time.sleep(4)
  complete(turn,'Live stream finished')
  return
 if 'interleaved-stream' in prompt:
  state[turn]['active']=False
  notify('item/agentMessage/delta',{'threadId':thread,'turnId':turn,'itemId':'message','delta':'First visible text. '})
  notify('item/started',{'threadId':thread,'turnId':turn,'item':{'id':'inspect','type':'commandExecution','command':'printf inspected'}})
  notify('item/completed',{'threadId':thread,'turnId':turn,'item':{'id':'inspect','type':'commandExecution','command':'printf inspected','aggregatedOutput':'inspected'}})
  notify('item/agentMessage/delta',{'threadId':thread,'turnId':turn,'itemId':'message','delta':'Second visible text.'})
  notify('item/completed',{'threadId':thread,'turnId':turn,'item':{'id':'message','type':'agentMessage','text':'First visible text. Second visible text.'}})
  notify('turn/completed',{'threadId':thread,'turn':{'id':turn,'status':'completed'}})
  return
 if 'interleaved-thinking' in prompt:
  state[turn]['active']=False
  notify('item/agentMessage/delta',{'threadId':thread,'turnId':turn,'itemId':'message','delta':'First text. '})
  notify('item/reasoning/summaryTextDelta',{'threadId':thread,'turnId':turn,'itemId':'thought-one','delta':'First thought.'})
  notify('item/agentMessage/delta',{'threadId':thread,'turnId':turn,'itemId':'message','delta':'Second text. '})
  notify('item/reasoning/summaryTextDelta',{'threadId':thread,'turnId':turn,'itemId':'thought-two','delta':'Second thought.'})
  notify('item/agentMessage/delta',{'threadId':thread,'turnId':turn,'itemId':'message','delta':'Third text.'})
  notify('item/completed',{'threadId':thread,'turnId':turn,'item':{'id':'message','type':'agentMessage','text':'First text. Second text. Third text.'}})
  notify('turn/completed',{'threadId':thread,'turn':{'id':turn,'status':'completed'}})
  return
 if 'typed-file-changes' in prompt:
  for item_id,kind,file_path,status in [('change-one','update','src/shared.ts','completed'),('change-two','add','src/shared.ts','completed'),('change-three','update','src/other.ts','failed')]:
   item={'id':item_id,'type':'fileChange','status':'inProgress','changes':[{'kind':kind,'path':file_path}]}
   notify('item/started',{'threadId':thread,'turnId':turn,'item':item})
   finished={**item,'status':status}
   if item_id=='change-one':finished.pop('changes')
   notify('item/completed',{'threadId':thread,'turnId':turn,'item':finished})
  complete(turn,'Typed files inspected')
  return
 if 'flood' in prompt:
  for _ in range(40):notify('item/agentMessage/delta',{'threadId':thread,'turnId':turn,'delta':'x'*300000})
  return
 if 'reasoning-content' in prompt:
  notify('item/reasoning/summaryTextDelta',{'threadId':thread,'turnId':turn,'itemId':'reasoning-one','delta':'First, inspect the files.'})
  complete(turn,'Reasoning reached the native transcript.')
  return
 if 'huge-nonimage' in prompt:
  notify('item/completed',{'threadId':thread,'turnId':turn,'item':{'id':'huge-tool','type':'mcpToolCall','result':'UNRETAINED_NONIMAGE_SENTINEL'*400000}})
  return
 if 'generated-image' in prompt:
  root=os.path.join(os.environ['CODEX_HOME'],'generated_images',sid);os.makedirs(root,exist_ok=True)
  fixture=os.environ.get('OPENADE_TEST_IMAGE_FIXTURE') or os.path.abspath(os.path.join(os.path.dirname(__file__),'..','..','fixtures','preview-grid.png'))
  source=os.path.join(root,'created.png')
  if 'external' in prompt:
   source=os.path.join(os.environ['OPENADE_PROVIDER_HOME'],'outside-generated.png')
   with open(source,'wb') as out,open(fixture,'rb') as inp:out.write(inp.read())
  if 'symlink' in prompt:
   source=os.path.join(root,'linked.png')
   if os.path.lexists(source):os.unlink(source)
   outside=os.path.join(os.environ['OPENADE_PROVIDER_HOME'],'outside-generated.png')
   with open(outside,'wb') as out,open(fixture,'rb') as inp:out.write(inp.read())
   os.symlink(outside,source)
  elif 'invalid' in prompt:
   with open(source,'wb') as out:out.write(b'not an image')
  elif 'oversized' in prompt:
   with open(source,'wb') as out:out.truncate(24*1024*1024+1)
  elif 'external' not in prompt and 'missing' not in prompt:
   with open(source,'wb') as out,open(fixture,'rb') as inp:out.write(inp.read())
  kind='image_generation' if 'snake' in prompt else 'imageGeneration'
  notify('item/started',{'threadId':thread,'turnId':turn,'item':{'id':'fixture-image','type':kind,'status':'inProgress'}})
  item={'id':'fixture-image','type':kind,'status':'failed' if 'failure' in prompt else 'completed',
        'saved_path' if 'snake' in prompt else 'savedPath':source,
        'revisedPrompt':'PRIVATE_REVISED_PROMPT_SENTINEL'}
  if 'large-inline' in prompt:item['result']='INLINE_IMAGE_SENTINEL'*550000
  if 'failure' in prompt:item['failure']={'type':'usageLimitExceeded','message':'private provider detail'}
  notify('item/completed',{'threadId':thread,'turnId':turn,'item':item})
  if 'duplicate' in prompt:notify('item/completed',{'threadId':thread,'turnId':turn,'item':item})
  if 'replay-spoof' in prompt:
   outside=os.path.join(os.environ['OPENADE_PROVIDER_HOME'],'outside-generated.png')
   with open(outside,'wb') as out,open(fixture,'rb') as inp:out.write(inp.read())
   changed=dict(item);changed['savedPath']=outside;notify('item/completed',{'threadId':thread,'turnId':turn,'item':changed})
  complete(turn,'Generated image fixture reply')
  return
 if 'unknown' in prompt:emit({'id':700,'method':'unknown/method','params':{'threadId':thread,'turnId':turn}})
 if 'resume-child' in prompt:
  child='child-turn-1';revisit='revisit-'+turn
  notify('item/completed',{'threadId':thread,'turnId':turn,'item':{'type':'collabAgentToolCall','id':'send-followup','tool':'sendInput','status':'completed','receiverThreadIds':[child]}})
  notify('turn/started',{'threadId':child,'turn':{'id':revisit,'status':'inProgress'}})
  notify('turn/started',{'threadId':child,'turn':{'id':revisit,'status':'inProgress'}})
  notify('item/agentMessage/delta',{'threadId':child,'itemId':revisit,'delta':'Second assignment is running. '})
  complete(turn,'Parent delegated a follow-up')
  if 'held' in prompt:
   release=os.path.join(folder,sid+'.release-revisit')
   while not os.path.exists(release):time.sleep(.02)
  notify('item/agentMessage/delta',{'threadId':child,'itemId':revisit,'delta':'Second assignment finished.'})
  notify('turn/completed',{'threadId':child,'turn':{'id':revisit,'status':'completed'}})
  notify('turn/completed',{'threadId':child,'turn':{'id':revisit,'status':'completed'}})
  return
 if 'subagent' in prompt:
  if 'siblings' in prompt:
   for name in ('alpha','beta'):
    child='child-'+name+'-'+turn;spawn={'type':'collabAgentToolCall','id':'spawn-'+name,'tool':'spawnAgent','status':'inProgress','receiverThreadIds':[],'prompt':'Inspect '+name}
    notify('item/started',{'threadId':thread,'turnId':turn,'item':spawn})
    notify('item/completed',{'threadId':child,'item':{'type':'userMessage','id':name+'-prompt','text':'Inspect '+name}})
    notify('item/agentMessage/delta',{'threadId':child,'itemId':name+'-message','delta':name+' report'})
    if name=='alpha':notify('turn/completed',{'threadId':child,'turn':{'id':name+'-turn','status':'completed'}})
    notify('item/completed',{'threadId':thread,'turnId':turn,'item':{**spawn,'status':'completed','receiverThreadIds':[child]}})
   complete(turn,'Parent saw both agents')
   time.sleep(.25);notify('turn/completed',{'threadId':'child-beta-'+turn,'turn':{'id':'beta-turn','status':'completed'}})
   return
  child='child-'+turn
  if 'v2' in prompt:
   activity={'type':'subAgentActivity','id':'spawn-fixture','kind':'started','agentThreadId':child,'agentPath':'/root/fixture-audit'}
   notify('item/started',{'threadId':thread,'turnId':turn,'item':activity})
  else:
   spawn={'type':'collabAgentToolCall','id':'spawn-fixture','tool':'spawnAgent','status':'inProgress','receiverThreadIds':[],'prompt':'Inspect the fixture child'}
   notify('item/started',{'threadId':thread,'turnId':turn,'item':spawn})
  notify('turn/started',{'threadId':child,'turn':{'id':'child-turn','status':'inProgress'}})
  notify('item/completed',{'threadId':child,'item':{'type':'userMessage','id':'child-prompt','text':'Inspect the fixture child'}})
  notify('item/agentMessage/delta',{'threadId':child,'itemId':'child-message','delta':'Child is working. '})
  if 'nested' in prompt:
   nested={'type':'collabAgentToolCall','id':'nested-spawn','tool':'spawnAgent','status':'inProgress','receiverThreadIds':[],'prompt':'Inspect nested dependency'}
   notify('item/started',{'threadId':child,'item':nested})
   notify('item/completed',{'threadId':child,'item':{**nested,'status':'completed','receiverThreadIds':['grandchild-'+turn]}})
   notify('turn/completed',{'threadId':'grandchild-'+turn,'turn':{'id':'grandchild-turn','status':'completed'}})
  if 'early' in prompt:
   notify('item/agentMessage/delta',{'threadId':child,'itemId':'child-message','delta':'Finished early.'})
   notify('turn/completed',{'threadId':child,'turn':{'id':'child-turn','status':'completed'}})
   notify('item/agentMessage/delta',{'threadId':child,'itemId':'child-message','delta':'STALE_AFTER_DONE'})
  if 'failed-spawn' in prompt:
   notify('item/completed',{'threadId':thread,'turnId':turn,'item':{**spawn,'status':'failed'}})
  elif 'v2' in prompt:
   notify('item/completed',{'threadId':thread,'turnId':turn,'item':activity})
  else:
   notify('item/completed',{'threadId':thread,'turnId':turn,'item':{**spawn,'status':'completed','receiverThreadIds':[child]}})
  notify('item/completed',{'threadId':thread,'turnId':turn,'item':{'type':'collabAgentToolCall','id':'wait-fixture','tool':'wait','status':'completed','receiverThreadIds':[child]}})
  complete(turn,'Parent completed independently')
  if 'early' not in prompt and 'failed-spawn' not in prompt:
   if 'bounded' in prompt:
    for _ in range(70):notify('item/agentMessage/delta',{'threadId':child,'itemId':'child-message','delta':'x'*64000})
   if 'held' in prompt:
    release=os.path.join(folder,sid+'.release-child')
    while not os.path.exists(release):time.sleep(.02)
   else:time.sleep(.4)
   notify('item/agentMessage/delta',{'threadId':child,'itemId':'child-message','delta':'Finished after parent.'})
   notify('turn/completed',{'threadId':child,'turn':{'id':'child-turn','status':'completed'}})
  return
 if 'child' in prompt:notify('turn/completed',{'threadId':'child-thread','turn':{'id':turn,'status':'completed'}})
 if 'question' in prompt or 'obsolete' in prompt:
  state[turn]['request']=501
  emit({'id':501,'method':'item/tool/requestUserInput','params':{'threadId':thread,'turnId':turn,'itemId':'input','isBlocking':True,'questions':[{'id':'approach','header':'Approach','question':'Which approach should we use?','isOther':True,'isSecret':False,'options':[{'label':'Simple','description':'Keep the existing architecture'},{'label':'Detailed','description':'Explore alternatives'}]},{'id':'private','header':'Private','question':'Enter a private fixture answer','isSecret':True,'isOther':True,'options':[]}]}})
  if 'multi-question' in prompt:
   state[turn]['remaining']=[501,503]
   emit({'id':503,'method':'item/tool/requestUserInput','params':{'threadId':thread,'turnId':turn,'itemId':'input2','isBlocking':True,'questions':[{'id':'second','header':'Next request','question':'A second pending request','options':[{'label':'Continue','description':'Proceed after the first request'}]}]}})
  if 'obsolete' in prompt:
   time.sleep(.3);notify('serverRequest/resolved',{'threadId':thread,'requestId':501});state[turn].pop('request',None)
  return
 if 'concealed-' in prompt:
  variant=prompt.split('concealed-',1)[1].split()[0];params={'threadId':thread,'turnId':turn,'itemId':'cmd','startedAtMs':1,'command':'printf approved','cwd':os.getcwd(),'reason':'Fixture approval'};method='item/commandExecution/requestApproval'
  if variant=='network':params.update(command=None,reason=None,networkApprovalContext={'host':'example.invalid','protocol':'https'})
  elif variant=='permissions':params['additionalPermissions']={'network':{'enabled':True}}
  elif variant=='stdin':params['kind']='stdin'
  elif variant=='environment':params['environmentId']='other-environment'
  elif variant=='empty':params['command']=None
  elif variant=='oversized':params['command']='x'*32769
  elif variant=='root':method='item/fileChange/requestApproval';params['grantRoot']='/fixture/session-wide'
  elif variant=='file-empty':method='item/fileChange/requestApproval';params['reason']=None
  elif variant=='file-generic':method='item/fileChange/requestApproval';params['reason']='Needs extra write access'
  state[turn]['request']=502;emit({'id':502,'method':method,'params':params});return
 if 'approval' in prompt:
  state[turn]['request']=502
  emit({'id':502,'method':'item/commandExecution/requestApproval','params':{'threadId':thread,'turnId':turn,'itemId':'cmd','startedAtMs':1,'command':'printf approved','cwd':os.getcwd(),'availableDecisions':['accept','decline','cancel'],'reason':'Fixture command outside the normal sandbox'}});return
 if 'partial-before-steer' in prompt:
  notify('item/agentMessage/delta',{'threadId':thread,'turnId':turn,'itemId':'message','delta':'Partial before steering'})
  return
 if 'wait' in prompt:return
 time.sleep(.2);complete(turn,prompt)
for line in sys.stdin:
 frame=json.loads(line)
 if 'jsonrpc' in frame:sys.exit(9)
 method=frame.get('method');params=frame.get('params',{})
 if method:
  note({'method':method,'pid':os.getpid(),'threadId':params.get('threadId'),'expectedTurnId':params.get('expectedTurnId')})
 if method=='initialize':result(frame,{'userAgent':'fixture'})
 elif method=='initialized':pass
 elif method in ('thread/start','thread/resume'):
  if method=='thread/resume':thread=params['threadId']
  assert params['sandbox']=='workspace-write' and params['approvalPolicy']=='on-request'
  result(frame,{'thread':{'id':thread}})
 elif method=='turn/start':
  assert params['sandboxPolicy']['type']=='workspaceWrite' and params['sandboxPolicy']['networkAccess']==False
  assert params['approvalPolicy']=='on-request' and params['approvalsReviewer']=='user'
  counter+=1;turn='turn-'+str(counter);state[turn]={'active':True};prompt=params['input'][0]['text'];note({'inputTypes':[item['type'] for item in params['input']],'turn':turn})
  notify('turn/started',{'threadId':thread,'turn':{'id':turn,'status':'inProgress'}})
  if 'conflicting-start' in prompt:
   notify('turn/started',{'threadId':thread,'turn':{'id':'conflict','status':'inProgress'}});result(frame,{'turn':{'id':'conflict'}});continue
  if 'hold-start-ack' in prompt:
   note({'holdAck':True});continue
  if 'eof-final' in prompt or 'early-bad-start' in prompt:
   complete(turn,'Final tail survives EOF');result(frame,{'turn':{'id':'wrong-start' if 'early-bad-start' in prompt else turn}});sys.exit(0)
  result(frame,{'turn':{'id':'incorrect' if 'bad-ack' in prompt else turn}});threading.Thread(target=work,args=(turn,prompt),daemon=True).start()
 elif method=='turn/steer':
  turn=params['expectedTurnId'];text=params['input'][0]['text']
  if 'early-steer' in text:
   complete(turn,'Steered early response');result(frame,{'turnId':turn})
   if 'eof' in text:sys.exit(0)
  elif 'wrong-steer-ack' in text:result(frame,{'turnId':'different-turn'})
  elif 'empty-steer-ack' in text:result(frame,{})
  elif 'reject-steer' in text:emit({'id':frame['id'],'error':{'code':-32000,'message':'stale turn'}})
  elif 'uncertain-steer' in text:os._exit(8)
  elif not state.get(turn,{}).get('active'):emit({'id':frame['id'],'error':{'code':-32000,'message':'not active'}})
  else:
   result(frame,{'turnId':turn});time.sleep(.08);complete(turn,'Steered: '+text)
 elif method=='turn/interrupt':
  turn=params['turnId'];result(frame,{});state[turn]['active']=False;notify('turn/completed',{'threadId':thread,'turn':{'id':turn,'status':'interrupted'}})
 elif method:emit({'id':frame['id'],'error':{'code':-32601,'message':'unsupported'}})
 else:
  # Record only the decision and answer count, never answer text.
  for turn,data in state.items():
   if data.get('request')==frame.get('id') or frame.get('id') in data.get('remaining',[]):
    reply=frame.get('result',{});note({'reply':frame['id'],'decision':reply.get('decision'),'answerCount':len(reply.get('answers',{})),'errorCode':frame.get('error',{}).get('code')});notify('serverRequest/resolved',{'threadId':thread,'requestId':frame['id']});data.pop('request',None)
    if data.get('remaining'):
     data['remaining'].remove(frame['id'])
     if data['remaining']:break
    complete(turn,'Answered safely');break
  if frame.get('id')==700:note({'unknownError':frame.get('error',{}).get('code')})
