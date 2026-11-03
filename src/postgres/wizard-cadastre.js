// Compatibility adapter for the cadastro SOAP mapping/response bugs in NFeWizard 1.1.4.
export async function consultCadastre(wizard, payload, axios) {
  const service = wizard.nfeWizardService;
  const originalSoapInfo = service.utility.getSoapInfo.bind(service.utility);
  service.utility.getSoapInfo = (uf, method) => {
    if (method !== 'NfeConsultaCadastro') return originalSoapInfo(uf, method);
    const info = service.utility.getSoapInfo1(uf, method);
    return {...info, method: info.method.replace(/\/$/, '')};
  };
  const agent = service.environment.getHttpAgent();
  agent.options.rejectUnauthorized = true;
  const transport = axios.create({httpsAgent: agent, timeout: 25000,
    maxContentLength: 2000000, maxBodyLength: 2000000, maxRedirects: 0,
    responseType: 'text', transformResponse: [value => value]});
  let raw;
  // An object avoids the SDK Proxy wrapping callable axios and losing its properties.
  service.axios = {post: async (...args) => {
    const response = await transport.post(...args);
    raw = response.data;
    return response;
  }};
  try {
    const result = await wizard.NFE_ConsultaCadastro(payload);
    return raw ?? result;
  } catch (error) {
    // Preserve a received SOAP response when the SDK cannot parse retConsCad.
    if (raw === undefined) throw error;
    return raw;
  }
}
