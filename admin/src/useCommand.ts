import { useState } from 'react';
import { ApiError } from './api';
import type { Api, PendingCommand } from './api';
import { message } from './ui';
export function useCommand(api:Api,onSuccess:(result:Record<string,unknown>)=>Promise<void>|void) {
  const [busy,setBusy]=useState(false),[pending,setPending]=useState<PendingCommand|null>(null),[error,setError]=useState(''),[conflict,setConflict]=useState(false);
  async function send(command:PendingCommand){setBusy(true);setError('');try{const result=await api.request<Record<string,unknown>>(command.path,command.method,command.body);setPending(null);setConflict(false);await onSuccess(result);}catch(e){if(e instanceof ApiError&&e.status===499)return;setError(message(e));if(e instanceof ApiError&&e.status===0)setPending(command);if(e instanceof ApiError&&e.status===409){setPending(null);setConflict(true);}}finally{setBusy(false);}}
  return {busy,pending,error,conflict,send,retry:()=>pending&&send(pending),reset:()=>{setPending(null);setError('');setConflict(false);}};
}
