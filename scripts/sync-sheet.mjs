// Read-only Google Sheets sync. Requires a dedicated service account with Viewer access.
import { readFile, writeFile } from 'node:fs/promises';
import { createSign } from 'node:crypto';
const configPath=new URL('../data/snapshot.json',import.meta.url);
const db=JSON.parse(await readFile(configPath,'utf8'));
if(!process.env.GOOGLE_SERVICE_ACCOUNT_JSON){
  console.error('Set GOOGLE_SERVICE_ACCOUNT_JSON and share the spreadsheet with that service account as Viewer. No data was changed.');
  process.exit(1);
}
try{
 let credentials;
 try{credentials=JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);}catch{throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON');}
 if(!credentials.client_email||!credentials.private_key)throw new Error('Missing service-account fields');
 const now=Math.floor(Date.now()/1000);
 const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
 const unsigned=encode({alg:'RS256',typ:'JWT'})+'.'+encode({iss:credentials.client_email,scope:'https://www.googleapis.com/auth/spreadsheets.readonly',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600});
 const sign=createSign('RSA-SHA256');sign.update(unsigned);sign.end();
 const assertion=unsigned+'.'+sign.sign(credentials.private_key,'base64url');
 const tokenResponse=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),signal:AbortSignal.timeout(30000)});
 if(!tokenResponse.ok)throw new Error('Google authorization failed (HTTP '+tokenResponse.status+')');
 const {access_token}=await tokenResponse.json();
 const ranges={'Обзор':'A1:AA65','Города':'A1:AA65','Драйверы запуска':'A1:I65','Паспорт решения':'A1:F65','Пилот и контроль':'A1:F65','Денежный поток 2.0':'A1:AB260','Пятёрка городов':'A1:M45'};
 const url=new URL('https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(db.spreadsheetId)+'/values:batchGet');
 url.searchParams.set('valueRenderOption','FORMATTED_VALUE');
 for(const [tab,range]of Object.entries(ranges))url.searchParams.append('ranges',"'"+tab.replace(/'/g,"''")+"'!"+range);
 const response=await fetch(url,{headers:{Authorization:'Bearer '+access_token},signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw new Error('Google Sheets read failed (HTTP '+response.status+')');
 const data=await response.json();
 if(data.valueRanges?.length!==Object.keys(ranges).length)throw new Error('Incomplete spreadsheet response');
 const tabs=Object.fromEntries(Object.keys(ranges).map((name,i)=>[name,data.valueRanges[i].values||[]]));
 if(tabs['Денежный поток 2.0'].find(r=>r[0]==='Сценарий')?.[1]!=='Базовый')throw new Error('Select the base scenario in the spreadsheet before syncing. The saved website snapshot was preserved.');
 if(tabs['Города'].slice(5,54).filter(r=>r[0]).length!==49)throw new Error('The city layout changed; review the website mapping before syncing.');
 // No Sheets write API is used. Refresh only the website snapshot.
 const next={...db,capturedAt:new Date().toISOString().slice(0,10),tabs};
 await writeFile(configPath,JSON.stringify(next,null,2)+'\n');
 console.log('Website snapshot updated from 7 sheets. Run npm run check before committing. Scenario comparisons retain their source snapshot date.');
}catch(error){
 // Do not print credential objects, JWTs, access tokens or raw Google responses.
 console.error('Sync failed: '+error.message);
 process.exit(1);
}
