// Administrative CLI. Never expose route writes as a public tenant API.
import {readFile} from 'node:fs/promises';
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient,TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
const d=JSON.parse(await readFile(process.argv[2],'utf8')),appId=process.env.META_APP_ID||'1793938688602287',table=process.env.ROUTES_TABLE,region=process.env.AWS_REGION||'sa-east-1';
if(!table||!/^\d{5,30}$/.test(d.phoneNumberId)||!/^\d{5,30}$/.test(d.wabaId)||!/^\d{12}$/.test(d.accountId)||!d.tenantId||!d.establishmentId||!/^[a-z0-9-]{1,30}$/.test(d.cellId))throw new Error('Invalid route configuration');
const queueUrl=`https://sqs.${region}.amazonaws.com/${d.accountId}/bansir-meta-cell-${d.cellId}`;
const db=DynamoDBDocumentClient.from(new DynamoDBClient({region}));
await db.send(new TransactWriteCommand({TransactItems:[{Put:{TableName:table,Item:{pk:'CELL#'+d.cellId,queueUrl,enabled:true},ConditionExpression:'attribute_not_exists(pk) OR queueUrl = :q',ExpressionAttributeValues:{':q':queueUrl}}},{Put:{TableName:table,Item:{pk:`APP#${appId}#PHONE#${d.phoneNumberId}`,wabaId:d.wabaId,tenantId:d.tenantId,establishmentId:d.establishmentId,cellId:d.cellId,enabled:true},ConditionExpression:'attribute_not_exists(pk) OR (tenantId = :t AND establishmentId = :e AND cellId = :c AND wabaId = :w)',ExpressionAttributeValues:{':t':d.tenantId,':e':d.establishmentId,':c':d.cellId,':w':d.wabaId}}}]}));console.log('Route registered; no WhatsApp message sent.');
