import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validPhone,firstUnanswered,buildSummary} from '../quiz-core.mjs';
test('Phone accepts local/international formatting and rejects incomplete or meaningless input',()=>{
  for(const value of ['+7 (999) 123-45-67','89991234567','+44 20 7946 0958'])assert.equal(validPhone(value),true,value);
  for(const value of ['','12345','abcdefghij','00000000000','+79991234567890123','+7 999 123 45 67 extension'])assert.equal(validPhone(value),false,value);
});
test('Missing answers cannot be skipped and summary includes only selected answers',()=>{
  assert.equal(firstUnanswered({}),0);
  const answers={'Тип объекта':'Квартира','Площадь объекта':'80–150 м²'};
  assert.equal(firstUnanswered(answers),2);
  assert.equal(buildSummary(answers),'Квартира · 80–150 м²');
  answers['Состав работ']='Дизайн-проект';
  assert.equal(firstUnanswered(answers),-1);
});
