// Explicit discovery prevents private migration helpers and operational scripts
// whose names contain "test" from being executed by Node's default discovery.
import {readdirSync} from 'node:fs';
import {spawn} from 'node:child_process';
const files=readdirSync(new URL('../test/',import.meta.url)).filter(n=>n.endsWith('.test.js')&&!n.endsWith('.integration.test.js')).sort().map(n=>'test/'+n);
const child=spawn(process.execPath,['--test',...files],{cwd:new URL('../',import.meta.url),stdio:'inherit',env:{...process.env,NODE_ENV:'test'}});
child.once('error',()=>{process.exitCode=1;});
child.once('exit',code=>{process.exitCode=code??1;});
