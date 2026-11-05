import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import i18next from 'i18next';
import {parse} from '@babel/parser';

const es=JSON.parse(fs.readFileSync(new URL('../src/locales/es.json',import.meta.url)));
const en=JSON.parse(fs.readFileSync(new URL('../src/locales/en.json',import.meta.url)));
test('all translation catalogs have matching keys',()=>assert.deepEqual(Object.keys(es).sort(),Object.keys(en).sort()));
test('pluralization and interpolation work in both languages',async()=>{
 const instance=i18next.createInstance();await instance.init({resources:{es:{translation:es},en:{translation:en}},lng:'es',keySeparator:false});
 assert.equal(instance.t('table.count',{count:1}),'1 evento');assert.equal(instance.t('table.count',{count:2}),'2 eventos');
 await instance.changeLanguage('en');assert.equal(instance.t('table.count',{count:1}),'1 event');assert.equal(instance.t('table.count',{count:2}),'2 events');
 assert.equal(instance.t('detail.openId',{id:'abc'}),'View event abc');
});
test('static translation keys resolve and visible JSX contains no hardcoded prose',()=>{
 const invariant=new Set(['ZLINK','ZKBio Zlink','TROK','T','/','JSON','HTTP','ms']);
 for(const file of fs.readdirSync(new URL('../src/',import.meta.url)).filter(name=>name.endsWith('.tsx'))){
  const tree=parse(fs.readFileSync(new URL('../src/'+file,import.meta.url),'utf8'),{sourceType:'module',plugins:['typescript','jsx']});
  function walk(node){if(!node||typeof node!=='object')return;if(node.type==='JSXText'&&node.value.trim())assert.ok(invariant.has(node.value.trim()),`${file}: untranslated JSX ${node.value.trim()}`);
   if(node.type==='CallExpression'&&node.callee.name==='t'&&node.arguments[0]?.type==='StringLiteral')assert.ok((node.arguments[0].value in es || (node.arguments[0].value+"_one") in es),`${file}: missing key ${node.arguments[0].value}`);
   for(const[key,value]of Object.entries(node)){if(key==='loc')continue;if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object')walk(value)}
  }walk(tree);
 }
});
