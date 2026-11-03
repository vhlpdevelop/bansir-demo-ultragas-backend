const labels={NCM:'NCM',ncm:'NCM',CFOP:'CFOP',cfop:'CFOP',CEP:'CEP',cMun:'Código IBGE do município',CNPJCPF:'CPF/CNPJ do destinatário',IE:'Inscrição estadual',fone:'Telefone',cProdANP:'Código ANP',cest:'CEST'};
const formats={NCM:'informe 8 dígitos',ncm:'informe 8 dígitos',CFOP:'informe 4 dígitos',cfop:'informe um CFOP interno com 4 dígitos, iniciado por 5',CEP:'informe 8 dígitos',cMun:'informe 7 dígitos',CNPJCPF:'informe CPF com 11 ou CNPJ com 14 dígitos',IE:'informe de 2 a 14 dígitos',fone:'confira o telefone, com DDD e somente números',cProdANP:'informe 9 dígitos',cest:'informe 7 dígitos ou deixe vazio'};
export function validationMessage(issue){
 const path=issue?.path||[],key=path.at(-1),det=path.indexOf('det'),item=det>=0&&typeof path[det+1]==='number'?`Item ${path[det+1]+1} — `:'';
 if(issue?.code==='invalid_format'&&formats[key])return `${item}${labels[key]} inválido ou ausente: ${formats[key]}.`;
 return item+(issue?.message?.startsWith('Invalid')?'Confira os dados informados'+(labels[key]?': '+labels[key]:'')+'.':issue?.message||'Dados inválidos.');
}
