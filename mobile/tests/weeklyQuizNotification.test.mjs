import './helpers/resolve-ts.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createQuizNotificationConsumer, weeklyQuizNotificationId } from '../src/services/weeklyQuizNotificationIntent.ts';
const quiz={type:'weekly_quiz',quiz_id:'11111111-1111-4111-8111-111111111111'};

test('only an allowlisted weekly quiz notification can navigate',()=>{
  for(const data of [null,{},[],{type:'weekly_quiz'},{...quiz,quiz_id:'https://evil.invalid'}, {...quiz,type:'daily'}]) assert.equal(weeklyQuizNotificationId(data),null);
  assert.equal(weeklyQuizNotificationId(quiz),quiz.quiz_id);
});

test('cold and warm responses navigate once; a later notification reloads Quiz',()=>{
  const opened=[];const consumer=createQuizNotificationConsumer(id=>opened.push(id));
  assert.equal(consumer.consume('first',quiz),true);
  assert.equal(consumer.consume('first',quiz),false);
  assert.equal(consumer.consume('second',quiz),true);
  assert.deepEqual(opened,['first','second']);
});

test('account cleanup rejects in-flight events and never passes a supplied user or URL to navigation',()=>{
  const opened=[];const old=createQuizNotificationConsumer(id=>opened.push(id));
  old.dispose();assert.equal(old.consume('pending',quiz),false);
  const current=createQuizNotificationConsumer(id=>opened.push(id));
  assert.equal(current.consume('',quiz),false);
  current.consume('tap',{...quiz,user_id:'someone-else',url:'https://evil.invalid'});
  assert.deepEqual(opened,['tap']); // Screen loads from the current authenticated API.
});
