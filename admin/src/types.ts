export type Capability = 'review'|'approve'|'publish'|'request_generation'|'manage_reviewers';
export const capabilities: Capability[] = ['review','approve','publish','request_generation','manage_reviewers'];
export interface Member { user_id:string; invited_email:string; status:'active'|'revoked'; capabilities:Capability[]; requested_name:string|null; approved_name:string|null; version:number }
export interface Me { member:Member; onboarding_required:boolean; name_approval_pending:boolean; mfa_required:boolean }
export interface Page<T> { items:T[]; next_cursor:string|null; total?:number }
export interface Taxon { id:string; name:string; topic_id:string; topic_name:string; is_active:boolean; topic_active:boolean }
export interface QueueItem { id:string; concept_id?:string; title:string; slug:string; status:string; topic_name:string; subtopic_name:string; topic_id:string; subtopic_id:string; base_version?:number; content_version:number; approved_by?:string|null; assigned_to?:string|null; review_due_at?:string|null; overdue?:boolean; unchanged?:boolean }
export interface Lesson { title:string; summary:string; example:string; subtopic_slug:string; model:string; prompt_version:number; curriculum:{objective:string;difficulty:number;prerequisites:string[];references:{title:string;url:string}[]}; learning_package:{flashcard:{front:string;back:string};mcqs:{question:string;options:string[];correct_index:number;explanation?:string}[]} }
export interface Detail { id:string; concept_id?:string; status:string; base_version?:number; content_version?:number; token:string; body:Lesson; source_body?:Lesson; assigned_to?:string|null; review_due_at?:string|null; approved_by?:string|null; unchanged_legacy?:boolean; provenance?:{registered_name:string;reviewed_at:string}|null; diff?:{field:string;before:unknown;after:unknown}[]; validation:{valid:boolean;errors:{field:string;message:string}[]}; source_links:{title:string;url:string}[] }
export interface Event { id:string; registered_name:string; action:string; note:string; created_at:string; details:unknown }
export interface Revision { id:string;status:string;base_version:number;created_at:string }
export interface Job { id:string;concept_id:string;source_revision_id:string;result_revision_id:string|null;status:string;attempts:number;token:string;failure_code:string|null }
export interface Supply { published:number;drafts:number;pending:number;generating:number;failed:number;review_load:number;review_capacity:number;review_blocked:boolean;planning_required:boolean;generation_enabled:boolean;provider_configured:boolean }
export const checklist = { factual_accuracy:'Facts are accurate', usefulness:'Useful learning objective', clarity:'Clear, readable explanation', topic_subtopic_accuracy:'Correct topic and subtopic', example_quality:'Worked example is correct', flashcard_quality:'Flashcard tests useful recall', mcq_quality:'All 3 questions and answers checked', references_checked:'References opened and checked' };
export type CheckKey = keyof typeof checklist;
export const label = (s:string) => s.replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
export const shortId = (id:string) => id.slice(0,8).toUpperCase();
