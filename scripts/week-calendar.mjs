import assert from 'node:assert/strict';
export const addDays=(s,n)=>new Date(Date.parse(s+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
export function parisToday(){
  const value=process.env.SELECTION_TV_TODAY||new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  assert.match(value,/^\d{4}-\d{2}-\d{2}$/);
  assert.equal(addDays(value,0),value,'invalid calendar date');
  return value;
}
export function weekForSaturday(from){
  assert.equal(new Date(from+'T12:00:00Z').getUTCDay(),6,'issue must start on Saturday');
  const d=new Date(addDays(from,2)+'T00:00:00Z');
  d.setUTCDate(d.getUTCDate()+4-(d.getUTCDay()||7));
  const year=d.getUTCFullYear();
  const week=Math.ceil(((d-Date.UTC(year,0,1))/86400000+1)/7);
  return year+'-S'+String(week).padStart(2,'0');
}
export function calendarTarget(today=parisToday()){
  const weekday=new Date(today+'T12:00:00Z').getUTCDay();
  const from=addDays(today,(6-weekday+7)%7);
  const week=weekForSaturday(from);
  return {week,short:week.slice(5),from,to:addDays(from,6)};
}
export function validateCandidateCalendar(current,entry,today=parisToday()){
  assert(current?.from&&entry?.from,'publication dates missing');
  assert.equal(entry.week,weekForSaturday(entry.from),'week ID/calendar mismatch');
  assert.equal(entry.to,addDays(entry.from,6),'issue must end on Friday');
  assert(entry.from>current.from,'candidate must advance the published issue');
  assert.equal(entry.from,calendarTarget(today).from,'candidate must match the current cycle; do not publish an obsolete backlog');
  const skipped=[];
  for(let date=addDays(current.from,7);date<entry.from;date=addDays(date,7))skipped.push(weekForSaturday(date));
  return skipped;
}
