import { afterEach, describe, expect, it, vi } from 'vitest';
import { Api, ApiError, safeUrl, command } from './api';
import { readConfig } from './config';
afterEach(()=>vi.unstubAllGlobals());
describe('private request boundaries',()=>{
  it('discards an old account response, including late JSON parsing',async()=>{
    let finish!:(v:unknown)=>void;
    vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:()=>new Promise(r=>{finish=r;})})));
    const api=new Api('https://api.test');api.setToken('first',true);
    const pending=api.request('/queue');await vi.waitFor(()=>expect(finish).toBeDefined());
    api.setToken('second',true);finish({items:['private']});await expect(pending).rejects.toMatchObject({status:499});
  });
  it('denies redirects, omits cookies and disables caching',async()=>{
    const fetch=vi.fn(async()=>new Response('{}'));vi.stubGlobal('fetch',fetch);
    const api=new Api('https://api.test');api.setToken('test-token');await api.request('/me');
    expect(fetch.mock.calls[0]).toEqual(['https://api.test/v1/editorial/me',expect.objectContaining({redirect:'error',cache:'no-store',credentials:'omit'})]);
  });
  it('does not echo server diagnostics and signals revoked authority',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response('secret diagnostics',{status:403})));
    const api=new Api('https://api.test');api.setToken('t');api.onDenied=vi.fn();await expect(api.request('/queue')).rejects.toBeInstanceOf(ApiError);expect(api.onDenied).toHaveBeenCalledWith(403);
  });
  it('creates a unique operation with an exact source token',()=>{const a=command('source','Checked references');expect(a.expected_token).toBe('source');expect(a.request_id).not.toBe(command('source','Checked references').request_id);});
  it('rejects executable and credential-bearing links',()=>{expect(safeUrl('javascript:alert(1)')).toBeUndefined();expect(safeUrl('https://user:password@example.com')).toBeUndefined();expect(safeUrl('https://example.com/docs')).toBe('https://example.com/docs');});
  it('rejects privileged build keys and insecure origins',()=>{
    const base={VITE_API_URL:'https://api.test',VITE_SUPABASE_URL:'https://auth.test',VITE_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test'};
    expect(readConfig(base).apiUrl).toBe('https://api.test');
    expect(()=>readConfig({...base,VITE_SUPABASE_PUBLISHABLE_KEY:'sb_secret_private'})).toThrow();
    expect(()=>readConfig({...base,VITE_SUPABASE_PUBLISHABLE_KEY:'x.'+btoa(JSON.stringify({role:'service_role'}))+'.x'})).toThrow();
    expect(()=>readConfig({...base,VITE_API_URL:'http://api.test'})).toThrow();
  });
});
