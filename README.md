# Framme — Genjutsu Studio

## Painel local

O cabeçalho exibe o saldo da carteira e abre o modal Adicionar créditos. Os
pacotes ficam em `plans.json`: Starter 350 / R$ 49, Pro 1.500 / R$ 197 e Scale
5.500 / R$ 697. Preencha `checkoutUrl` com o link HTTPS público correspondente
da Cakto para ativar o botão do pacote, sem reiniciar o servidor. Sem link, o
pagamento permanece desativado. O modal não coleta dados de pagamento.
Os links apenas redirecionam; confirmação de compra e concessão de créditos
dependem da integração futura com webhooks e carteira. Saldo indisponível é
mostrado como “0 créditos” na interface; a carteira ainda não está integrada.

O seletor de quantidade ao lado da resolução permite de 1 a 4 vídeos. A cotação
mostra o total (custo arredondado por vídeo × quantidade) e fica vinculada a essa
quantidade. O servidor envia pedidos separados em sequência, sem parâmetro de
lote ao modelo. Cada resultado tem seleção e download próprios. Se um pedido
ficar sem confirmação, os próximos não são enviados; resultados já concluídos
continuam disponíveis. Os testes de integração usam um provedor simulado.

Execute `npm run dev` e abra http://127.0.0.1:3210.
O painel oferece Motion Transfer e Object Swap. Selecione um vídeo MP4
local. Adicione imagens de referência por upload, escolha
resolução e, opcionalmente, descreva a transformação. A geração usa o SDK oficial
com `subscribe` e polling explícito; cada pedido é pago. A chave é carregada apenas pelo
servidor a partir de `.env.local`.

Motion Transfer e Object Swap aceitam de 1 a 8 referências. Restyle aceita de 0 a
5 e exige um estilo do catálogo da conta, atualizado e validado no servidor.
O vídeo precisa ter pelo menos 4 segundos; apenas os primeiros 30 s são usados.
Object Swap exige pelo menos 409.600 pixels por quadro. Para arquivos locais,
o navegador verifica duração e dimensões antes do envio; links remotos e a
decodificação final são validados pelo Higgsfield. O painel limita uploads a
200 MiB por vídeo e 64 MiB por imagem. Duração e proporção vêm do vídeo original;
Restyle preserva o áudio da origem.

Os arquivos são enviados ao selecionar as entradas necessárias para cotação. O servidor
obtém a URL de upload oficial, transmite o arquivo com os cabeçalhos retornados
e passa a URL pública ao modelo. A chave nunca é enviada ao armazenamento ou
ao navegador. Arquivos ficam apenas temporariamente na memória local durante o
upload. Reenvios do mesmo arquivo na mesma página reutilizam a URL já obtida.
O servidor consulta `/estimate/{model}` e converte US$ 0,01 em um crédito Framme,
arredondando para cima. Uma cotação expira após 5 minutos e só pode ser usada uma
vez; a geração utiliza exatamente as entradas cotadas. Nenhuma geração é enviada
se a cotação falhar. A carteira Framme ainda não está ativada: o botão mostra o
custo estimado, e a cobrança real continua ocorrendo na conta Higgsfield.

O avatar abre `/profile`, onde nome e foto ficam salvos localmente. É possível
criar uma senha e depois trocá-la informando a senha atual. Senhas são derivadas
com scrypt; sessões usam cookies HttpOnly/SameSite. O servidor continua restrito
ao computador local. Esta conta única não substitui a autenticação multiusuário
e HTTPS exigidos para publicação. Plano e saldo ficam sem ativação até integrar
a carteira e a Cakto. Os dados em `.data/` são ignorados pelo Git.

O loading mostra fase real e tempo decorrido. A faixa inicial de 5–15 minutos
é uma heurística provisória da interface, não um prazo fornecido pela API;
quando ultrapassada, a interface informa o atraso sem fingir conclusão.
Após salvar uma nova chave localmente, o painel detecta a configuração.
O servidor aceita uma geração de cada vez e salva o último pedido em `.data/`.
Após reiniciar, resultados concluídos são recuperados; pedidos em andamento ficam
como não verificados para consulta no provedor. Não são reenviados automaticamente.
O botão Baixar transmite o vídeo pelo servidor como arquivo para download.

Requires Node.js and npm. Install dependencies with `npm ci`.

Edit `.env.local` locally, replacing the placeholder with your API credential in
`HF_CREDENTIALS=key-id:key-secret` format. Never paste the value into chat or commit
it. `.gitignore` excludes environment files. The script loads the file at runtime
and never prints credentials or raw SDK error objects.

Use `npm run check` e `npm test` para verificar tipos e validações sem gerar vídeos.

## Exemplo original Seedance

O `index.ts` original foi preservado. `npm start` ainda executa o exemplo pago
Seedance 2.5. Para usar Genjutsu, execute `npm run dev` e utilize o painel.
The example uses the official `subscribe` method with polling and prints a video
URL only after a completed response. Each new run can incur another charge;
submission retries are disabled to reduce accidental duplicate generation.

O exemplo CLI original usa o polling interno do SDK. O painel usa polling
explícito para distinguir fila, processamento e cancelamento. Consulte o pedido
no provedor antes de repetir uma execução com status não verificado.

Official references:
- https://open.higgsfield.ai/models/higgsfield/genjutsu/motion-transfer/v1.0/api-reference
- https://open.higgsfield.ai/models/higgsfield/genjutsu/object-swap/v1.0/api-reference
- https://open.higgsfield.ai/models/higgsfield/genjutsu/restyle/v1.0/api-reference
- https://docs.higgsfield.ai/docs/concepts/file-uploads
- https://docs.higgsfield.ai/docs/how-to/sdk
- https://console.higgsfield.ai/models/bytedance/seedance-2.5/text-to-video/api-reference

Live verification is pending local credential entry. Type-checking alone does
not verify access to the model or successful video generation.

### Cotação por duração (atualizado em 07/10/2026)
O painel usa a tabela pública do Genjutsu: US$ 0,318/s em 480p e US$ 0,681/s em 720p, sem descontos de conta. Fonte: https://open.higgsfield.ai/models/higgsfield/genjutsu/motion-transfer/v1.0/playground . O servidor lê `moov/mvhd` do MP4 enviado, limita a 30 segundos e arredonda a duração para cima. Créditos por vídeo = teto(segundos × tarifa USD × 100); o total multiplica pela quantidade. A cotação anterior via endpoint externo foi substituída por essa regra. Não representa uma consulta ao saldo ou preço individual da conta Higgsfield. Arquivos sem duração MP4 legível são rejeitados com instrução de reexportação. Nenhum valor de duração ou preço enviado pelo navegador é usado como autoridade. A carteira e cobrança de créditos ainda precisam ser integradas aos pagamentos antes do lançamento público.
Testes da regra: `node --experimental-strip-types --test video-cost.test.mjs`.
