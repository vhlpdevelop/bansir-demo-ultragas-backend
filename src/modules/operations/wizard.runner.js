import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.once('message', async ({ action, model, key, payload }) => {
  let directory;
  let stage = 'setup';
  try {
    directory = await mkdtemp(join(tmpdir(), 'bansir-fiscal-'));
    const config = { dfe: { UF: 'MS', CPFCNPJ: process.env.FISCAL_CNPJ,
      pathCertificado: process.env.FISCAL_CERT_PATH, senhaCertificado: process.env.FISCAL_CERT_PASSWORD,
      armazenarXMLAutorizacao: true, pathXMLAutorizacao: directory,
      baixarXMLDistribuicao: false, armazenarXMLRetorno: false, armazenarXMLConsulta: false, armazenarRetornoEmJSON: false },
      nfe: { ambiente: 2, versaoDF: '4.00', idCSC: Number(process.env.FISCAL_CSC_ID), tokenCSC: process.env.FISCAL_CSC_TOKEN },
      lib: { connection: { timeout: 25000 }, log: { exibirLogNoConsole: false, armazenarLogs: false }, useOpenSSL: false, useForSchemaValidation: 'validateSchemaJsBased' } };
    config.nfce = { ...config.nfe };
    const library = await import('nfewizard-io');
    let result;
    if (action === 'consult') {
      // Public BaseNFE API: select NFCe endpoints explicitly (default NFe is wrong for model 65).
      const { Environment, Utility, XmlBuilder, SaveFiles, GerarConsulta, BaseNFE } = library;
      const environment = new Environment(config); const { axios } = await environment.loadEnvironment();
      const utility = new Utility(environment); const builder = new XmlBuilder(environment);
      class Consultation extends BaseNFE {
        getModelo() { return model === '65' ? 'NFCe' : 'NFe'; }
        gerarXml() { return builder.gerarXml({ $: { versao: '4.00', xmlns: 'http://www.portalfiscal.inf.br/nfe' }, tpAmb: 2, xServ: 'CONSULTAR', chNFe: key }, 'consSitNFe', 'NFEConsultaProtocolo'); }
      }
      const service = new Consultation(environment, utility, builder, 'NFEConsultaProtocolo', axios, new SaveFiles(environment, utility), new GerarConsulta(environment, utility, builder));
      stage = 'request';
      result = await service.Exec(key);
    } else {
      const Wizard = model === '65' ? (await import('@nfewizard/nfce')).NFCEWizard : library.default;
      const wizard = new Wizard();
      await wizard.NFE_LoadEnvironment({ config });
      stage = 'request';
      result = await wizard[model === '65' ? 'NFCE_Autorizacao' : 'NFE_Autorizacao'](payload);
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
  finally { if (directory) await rm(directory, { recursive: true, force: true }); process.disconnect(); }
});
