import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.once('message', async ({ action, model, key, payload, settings, certificate, csc, workDirectory }) => {
  let directory;
  let stage = 'setup';
  try {
    directory = workDirectory || await mkdtemp(join(tmpdir(), 'bansir-fiscal-'));
    const certPath=join(directory,'certificate.pfx');
    await writeFile(certPath,Buffer.from(certificate.base64,'base64'),{mode:0o600});
    const config = { dfe: { UF: settings.address.uf, CPFCNPJ: settings.cnpj,
      pathCertificado: certPath, senhaCertificado: certificate.password,
      armazenarXMLAutorizacao: true, pathXMLAutorizacao: directory,
      baixarXMLDistribuicao: false, armazenarXMLRetorno: false, armazenarXMLConsulta: false, armazenarRetornoEmJSON: false },
      nfe: { ambiente: settings.environment, versaoDF: '4.00', idCSC: Number(settings.cscId), tokenCSC: csc },
      lib: { connection: { timeout: 25000 }, log: { exibirLogNoConsole: false, armazenarLogs: false }, useOpenSSL: false, useForSchemaValidation: 'validateSchemaJsBased' } };
    config.nfce = { ...config.nfe };
    const library = await import('nfewizard-io');
    library.logger.initialize({exibirLogNoConsole:false,armazenarLogs:false});
    library.logger.logger.silent=true;
    let result;
    if(action==='distribute'){
      const {Environment,Utility,XmlBuilder,GerarConsulta}=library;
      const environment=new Environment(config),{axios}=await environment.loadEnvironment(),utility=new Utility(environment),builder=new XmlBuilder(environment);
      const xml=builder.gerarXml({$:{versao:'1.01',xmlns:'http://www.portalfiscal.inf.br/nfe'},tpAmb:settings.environment,cUFAutor:payload.ufCode,CNPJ:settings.cnpj,distNSU:{ultNSU:payload.ultNSU}},'distDFeInt','NFeDistribuicaoDFe');
      const query=await new GerarConsulta(environment,utility,builder).gerarConsulta(xml,'NFeDistribuicaoDFe',true,'1.01','NFe',true,'nfeDistDFeInteresse');
      query.agent.options.rejectUnauthorized=true;stage='request';
      result=(await axios.post(query.webServiceUrl,query.xmlFormated,{headers:{'Content-Type':'application/soap+xml; charset=utf-8'},httpsAgent:query.agent,timeout:30000,maxContentLength:16*1024*1024,maxBodyLength:2*1024*1024,maxRedirects:0,responseType:'text',transformResponse:[v=>v]})).data;
    } else if (action === 'consult') {
      // Public BaseNFE API: select NFCe endpoints explicitly (default NFe is wrong for model 65).
      const { Environment, Utility, XmlBuilder, SaveFiles, GerarConsulta, BaseNFE } = library;
      const environment = new Environment(config); const { axios } = await environment.loadEnvironment();
      const utility = new Utility(environment); const builder = new XmlBuilder(environment);
      class Consultation extends BaseNFE {
        getModelo() { return model === '65' ? 'NFCe' : 'NFe'; }
        gerarXml() { return builder.gerarXml({ $: { versao: '4.00', xmlns: 'http://www.portalfiscal.inf.br/nfe' }, tpAmb: settings.environment, xServ: 'CONSULTAR', chNFe: key }, 'consSitNFe', 'NFEConsultaProtocolo'); }
      }
      const service = new Consultation(environment, utility, builder, 'NFEConsultaProtocolo', axios, new SaveFiles(environment, utility), new GerarConsulta(environment, utility, builder));
      stage = 'request';
      result = await service.Exec(key);
    } else {
      const Wizard = model === '65' ? (await import('@nfewizard/nfce')).NFCEWizard : library.default;
      const wizard = new Wizard();
      await wizard.NFE_LoadEnvironment({ config });
      stage = 'request';
      if(action==='science'){
        const axios=(await import('axios')).default,service=wizard.nfeWizardService,agent=service.environment.getHttpAgent();agent.options.rejectUnauthorized=true;
        const transport=axios.create({httpsAgent:agent,timeout:30000,maxContentLength:2*1024*1024,maxBodyLength:2*1024*1024,maxRedirects:0});let raw;
        transport.interceptors.response.use(response=>{raw=response.data;return response;});service.axios=transport;
        try{result=await wizard.NFE_CienciaDaOperacao(payload);}catch(error){if(!raw)throw error;}
        if(raw)result=raw;
      }else result=await wizard[model==='65'?'NFCE_Autorizacao':'NFE_Autorizacao'](payload);
    }
    let xml;
    async function findXml(path) {
      for (const entry of await readdir(path, { withFileTypes: true })) {
        const file = join(path, entry.name);
        if (entry.isDirectory()) await findXml(file);
        else if (entry.name.endsWith('.xml')) {
          const value = await readFile(file, 'utf8');
          if (value.includes('<nfeProc') && value.includes(key) && value.includes('<protNFe')) xml = value;
        }
      }
    }
    await findXml(directory);
    process.send({ ok: true, data: { result, xml } });
  } catch (error) {
    // Only expose the fiscal rejection phrase, never raw HTTP/certificate/XML diagnostics.
    const rejection = String(error.message || '').match(/Rejei[çc][aã]o[^<\r\n]{0,240}/i)?.[0];
    process.send({ ok: false, stage, rejection });
  }
  finally { if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); process.disconnect(); }
});

