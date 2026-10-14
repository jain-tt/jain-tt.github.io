/* Content registry: loaded before any content file. */
(function(){
'use strict';
const C=window.COURSE={meta:{},volumes:[],lessons:{},order:[],questions:[],mocks:[],glossary:[],formulas:[],tools:[],runbooks:[],labs:[],pages:{}};
window.registerCurriculum=function(cur){C.meta=cur.meta||C.meta;C.volumes=cur.volumes||C.volumes;};
window.registerLesson=function(l){if(!l.id)throw new Error('lesson id');if(C.lessons[l.id])console.warn('duplicate lesson',l.id);l.quiz=l.quiz||[];l.flashcards=l.flashcards||[];l.objectives=l.objectives||[];l.prereqs=l.prereqs||[];l.next=l.next||[];l.tags=l.tags||[];l.glossary=l.glossary||[];C.lessons[l.id]=l;};
window.registerQuestion=function(q){if(!q.id)throw new Error('question id');C.questions.push(q);};
window.registerQuestions=function(arr){arr.forEach(registerQuestion);};
window.registerMock=function(m){C.mocks.push(m);};
const _gseen={};window.registerGlossary=function(arr){arr.forEach(g=>{const k=String(g.term).toLowerCase();if(_gseen[k]){const e=_gseen[k];e.aliases=[...new Set([...(e.aliases||[]),...(g.aliases||[])])];return;}_gseen[k]=g;C.glossary.push(g);});};
window.registerFormulas=function(arr){C.formulas.push(...arr);};
window.registerTools=function(arr){C.tools.push(...arr);};
window.registerRunbooks=function(arr){C.runbooks.push(...arr);};
window.registerLabs=function(arr){C.labs.push(...arr);};
window.registerPage=function(id,page){C.pages[id]=page;};
})();
