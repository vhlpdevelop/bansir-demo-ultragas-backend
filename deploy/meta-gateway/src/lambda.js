import {makeConnect} from './connect.js';
import {SQSClient,SendMessageCommand} from '@aws-sdk/client-sqs';
import {SecretsManagerClient,GetSecretValueCommand} from '@aws-sdk/client-secrets-manager';
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient,GetCommand,TransactWriteCommand,UpdateCommand} from '@aws-sdk/lib-dynamodb';
import {makeIngress,makeRouter} from './core.js';
const sqs=new SQSClient({}),sm=new SecretsManagerClient({}),db=DynamoDBDocumentClient.from(new DynamoDBClient({}));let cached;
const appId=process.env.META_APP_ID;
async function secrets(){if(cached&&cached.until>Date.now())return cached.value;const result=await sm.send(new GetSecretValueCommand({SecretId:process.env.META_SECRET_ARN}));const value=JSON.parse(result.SecretString);cached={value,until:Date.now()+60000};return value;}
export const ingress=makeIngress({appId,secrets,enqueue:body=>sqs.send(new SendMessageCommand({QueueUrl:process.env.INGRESS_QUEUE_URL,MessageBody:JSON.stringify(body)}))});
export const router=makeRouter({appId,resolve:async phone=>{
 const {Item}=await db.send(new GetCommand({TableName:process.env.ROUTES_TABLE,Key:{pk:`APP#${appId}#PHONE#${phone}`},ConsistentRead:true}));return Item;
},send:async(route,body)=>{
 const {Item:cell}=await db.send(new GetCommand({TableName:process.env.ROUTES_TABLE,Key:{pk:'CELL#'+route.cellId},ConsistentRead:true}));
 const prefix=`https://sqs.${process.env.AWS_REGION}.amazonaws.com/${process.env.AWS_ACCOUNT_ID}/bansir-meta-cell-`;
 if(!cell?.enabled||typeof cell.queueUrl!=='string'||!cell.queueUrl.startsWith(prefix)||!/^https:\/\/[^/]+\/\d{12}\/bansir-meta-cell-[a-z0-9-]+$/.test(cell.queueUrl))throw new Error('INVALID_DESTINATION');
 await sqs.send(new SendMessageCommand({QueueUrl:cell.queueUrl,MessageBody:JSON.stringify(body)}));
}});

const routeKey=phone=>({pk:`APP#${appId}#PHONE#${phone}`});
const condition='tenantId=:t AND establishmentId=:e AND cellId=:c AND connectionId=:n';
const values=c=>({':t':c.tenantId,':e':c.establishmentId,':c':process.env.CELL_ID,':n':c.connectionId});
export const connect=makeConnect({appId,cellId:process.env.CELL_ID,queueUrl:process.env.CELL_QUEUE_URL,version:process.env.META_GRAPH_VERSION,secrets,
 reserve:async(phone,c)=>db.send(new TransactWriteCommand({TransactItems:[{Put:{TableName:process.env.ROUTES_TABLE,Item:{pk:'CELL#'+process.env.CELL_ID,queueUrl:process.env.CELL_QUEUE_URL,enabled:true},ConditionExpression:'attribute_not_exists(pk) OR queueUrl=:q',ExpressionAttributeValues:{':q':process.env.CELL_QUEUE_URL}}},{Put:{TableName:process.env.ROUTES_TABLE,Item:{...routeKey(phone),tenantId:c.tenantId,establishmentId:c.establishmentId,cellId:process.env.CELL_ID,connectionId:c.connectionId,wabaId:c.wabaId,enabled:false},ConditionExpression:'attribute_not_exists(pk) OR (tenantId=:t AND establishmentId=:e AND cellId=:c)',ExpressionAttributeValues:{':t':c.tenantId,':e':c.establishmentId,':c':process.env.CELL_ID}}}]})),
 activate:(phone,c)=>db.send(new UpdateCommand({TableName:process.env.ROUTES_TABLE,Key:routeKey(phone),UpdateExpression:'SET enabled=:b',ConditionExpression:condition,ExpressionAttributeValues:{...values(c),':b':true}})),
 disable:(phone,c)=>db.send(new UpdateCommand({TableName:process.env.ROUTES_TABLE,Key:routeKey(phone),UpdateExpression:'SET enabled=:b',ConditionExpression:condition,ExpressionAttributeValues:{...values(c),':b':false}}))
});
