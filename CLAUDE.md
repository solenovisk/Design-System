# Portfolio Agência — Projeto Claude Code

## Visão Geral

Sistema de gestão e portfólio dos sites criados pela agência, com interface estilo Netflix.
Domínios registrados na Hostinger são puxados via API. Subdomínios e clientes com hospedagem externa são cadastrados manualmente via painel admin.
Cada card exibe um screenshot do site via Thum.io, é organizado por categoria e pode ser filtrado, e redireciona para o site ao clicar.

**Custo total: R$ 0,00** — sem serviços pagos, sem APIs pagas.

---

## Stack — Zero Custo

| Camada | Escolha | Motivo |
|---|---|---|
| Backend | PHP nativo | Hostinger shared hosting já tem PHP; sem Node.js necessário |
| Frontend | HTML + CSS + JS vanilla | Sem framework, sem build step |
| Screenshots | Thum.io (free) | 1.000 req/mês, sem API key, usado direto como `<img src>` |
| Storage manual | `data/sites.json` | Volume pequeno; PHP lê/escreve direto |
| Admin auth | PHP session + password_hash | Nativo do PHP, sem biblioteca externa |
| Hospedagem | Subdomínio Hostinger existente | Sem custo adicional |

### Thum.io — Como funciona (zero config)

```html
<!-- Sem API key, sem backend, direto no HTML -->
<img src="https://image.thum.io/get/width/600/https://cliente.com.br" />
```

Thum.io faz o screenshot e entrega a imagem. Nada mais necessário.

---

## Arquitetura

```
[Hostinger API]              [data/sites.json]
GET /domains/v1/portfolio    subdomínios + externos
        ↓                           ↓
   [api/sites.php — PHP cURL + merge]
              ↓
   [Frontend JS fetch /api/sites.php]
              ↓
   [Cards renderizados no HTML — agrupados por categoria]
   screenshot = <img src="https://image.thum.io/get/width/600/{url}">
   click = window.open(url, '_blank')
```

Sem servidor Node.js. Sem processo rodando. PHP responde às requisições e o Thum.io entrega as imagens sob demanda.

---

## Estrutura de Arquivos

```
/ (raiz do subdomínio — ex: portfolio.agencia.com.br)
├── index.html                   # Portfólio Netflix-style
├── admin.html                   # Painel admin
├── .htaccess                    # Protege /config e /data
├── config/
│   └── config.php               # Token Hostinger + hash da senha admin
├── data/
│   └── sites.json               # Entradas manuais (subdomínios + externos)
├── api/
│   ├── sites.php                # GET → lista unificada (Hostinger + manual)
│   ├── admin/
│   │   ├── login.php            # POST → inicia sessão
│   │   ├── logout.php           # POST → encerra sessão
│   │   ├── sites.php            # CRUD do sites.json
│   │   └── auth.php             # Include: verifica sessão ativa
│   └── .htaccess                # Header JSON + bloqueia acesso direto a auth.php
├── css/
│   ├── main.css                 # Estilos portfólio
│   └── admin.css                # Estilos admin
└── js/
    ├── main.js                  # Lógica frontend portfólio
    └── admin.js                 # Lógica frontend admin
```

---

## Configuração (`config/config.php`)

```php
<?php
// Nunca commitar este arquivo — adicionar ao .gitignore
define('HOSTINGER_API_TOKEN', 'seu_token_aqui');
define('ADMIN_PASSWORD_HASH', password_hash('sua_senha_aqui', PASSWORD_DEFAULT));
define('SESSION_NAME', 'portfolio_admin');
```

> ⚠️ O `.htaccess` da raiz deve bloquear acesso HTTP direto à pasta `/config`:
> ```apache
> <FilesMatch "config\.php$">
>     Order allow,deny
>     Deny from all
> </FilesMatch>
> ```

---

## Modelo de Dados

### `data/sites.json`

```json
[
  {
    "id": "uuid-gerado",
    "nome": "Nome do Cliente",
    "url": "https://cliente.com.br",
    "tipo": "externo",
    "categoria": "Institucional",
    "ativo": true,
    "criado_em": "2025-01-01T00:00:00Z"
  },
  {
    "id": "uuid-gerado",
    "nome": "Projeto Subdomínio",
    "url": "https://projeto.agencia.com.br",
    "tipo": "subdominio",
    "categoria": "E-commerce",
    "ativo": true,
    "criado_em": "2025-01-01T00:00:00Z"
  }
]
```

**Tipos:** `hostinger` | `subdominio` | `externo`

**Categorias:** lista aberta, definida pelo admin ao cadastrar/editar um site (ex: `Institucional`, `E-commerce`, `Landing Page`, `Blog`, `Portfólio`, `Outro`). Domínios vindos da Hostinger sem categoria definida caem em `Sem Categoria`.

---

## API — Endpoints PHP

### `GET /api/sites.php`
Retorna lista unificada: domínios Hostinger ativos + entradas manuais ativas.
Sem autenticação — é pública (só leitura).

**Response:**
```json
[
  {
    "id": "string",
    "nome": "string",
    "url": "https://...",
    "tipo": "hostinger | subdominio | externo",
    "categoria": "string",
    "ativo": true
  }
]
```

**Lógica interna:**
1. cURL `GET https://api.hostinger.com/api/domains/v1/portfolio` com Bearer token
2. Paginar até não ter mais resultados (50 por página)
3. Filtrar apenas `status === "active"`
4. Fazer merge com entradas ativas do `sites.json`
5. Retornar array unificado como JSON
6. Em caso de erro na Hostinger API: logar erro, retornar apenas entradas manuais

---

### `POST /api/admin/login.php`

**Body (form ou JSON):** `{ "password": "string" }`

Verifica com `password_verify()`. Se correto, inicia sessão PHP e retorna `{ "ok": true }`.

---

### `POST /api/admin/logout.php`
Destrói sessão. Retorna `{ "ok": true }`.

---

### `GET /api/admin/sites.php`
Lista todas as entradas do `sites.json` (ativas e inativas).
Requer sessão ativa — include `auth.php`.

### `POST /api/admin/sites.php`
Adiciona nova entrada.

**Body JSON:**
```json
{ "nome": "string", "url": "https://...", "tipo": "subdominio | externo", "categoria": "string" }
```

Validar: `nome` não vazio, `url` válida, `tipo` permitido, `categoria` não vazia.
Gerar UUID v4 simples em PHP. Salvar no `sites.json`.

### `PUT /api/admin/sites.php?id={id}`
Atualiza entrada existente (nome, url, tipo, categoria, ativo).

### `DELETE /api/admin/sites.php?id={id}`
Remove entrada do `sites.json`.

---

## Frontend — Comportamento

### Portfólio (`index.html`)

- `fetch('/api/sites.php')` ao carregar
- **Estilo Netflix por categoria:**
  - Sites agrupados em "fileiras" (rows) horizontais por categoria, cada fileira com scroll horizontal
  - Cada fileira tem um título com o nome da categoria
  - Categorias sem nenhum site ativo não são exibidas
- **Filtros:**
  - Barra de filtros no topo: botões/chips por categoria + opção "Todos"
  - Filtro por tipo (`Hostinger` / `Subdomínio` / `Externo`)
  - Campo de busca por nome do cliente
  - Filtros combináveis (categoria + tipo + busca)
  - Ao filtrar, layout muda de "fileiras por categoria" para um grid único com os resultados
- Grid responsivo: 4 colunas desktop → 2 tablet → 1 mobile
- Cada card:
  - Screenshot via `<img src="https://image.thum.io/get/width/600/{url}">`
  - Fallback: placeholder cinza com ícone de globo se imagem falhar (`onerror`)
  - Nome do cliente sobreposto (bottom, gradiente escuro)
  - Badge de tipo: `Hostinger` / `Subdomínio` / `Externo`
  - Badge/label de categoria
  - Hover: leve zoom + sombra elevada
  - Click: `window.open(url, '_blank')`
- Skeleton cards animados durante loading
- Mensagem amigável se lista vazia ou filtro sem resultados

### Admin (`admin.html`)

**Tela de Login:**
- Formulário: campo senha + botão entrar
- `POST /api/admin/login.php` — se ok, redireciona para painel
- Mensagem de erro se senha incorreta

**Painel (após login):**
- Formulário: adicionar novo site (nome, URL, tipo, categoria)
- Categoria pode ser selecionada de uma lista existente ou criada digitando uma nova
- Tabela: todos os sites manuais — nome, URL, tipo, categoria, ativo/inativo, ações
- Filtro/busca na tabela por nome, tipo e categoria
- Ações: editar inline, toggle ativo/inativo, excluir (com confirmação)
- Botão logout
- Sessão verificada a cada requisição no backend — se expirada, redireciona ao login

---

## `.htaccess` da Raiz

```apache
# Protege arquivos sensíveis
<FilesMatch "\.(php)$">
    Order allow,deny
    Allow from all
</FilesMatch>

# Bloqueia acesso direto a config/ e data/
<IfModule mod_rewrite.c>
    RewriteEngine On
    RewriteRule ^config/ - [F,L]
    RewriteRule ^data/ - [F,L]
</IfModule>
```

## `api/.htaccess`

```apache
# Força Content-Type JSON em todas as respostas da API
<IfModule mod_headers.c>
    Header set Content-Type "application/json; charset=utf-8"
</IfModule>

# Bloqueia acesso direto a auth.php
<Files "auth.php">
    Order allow,deny
    Deny from all
</Files>
```

---

## Regras de Implementação

- Todo código PHP e JS em inglês (variáveis, funções, comentários)
- `config.php` obrigatoriamente no `.gitignore`
- Nunca expor o token da Hostinger no frontend
- Thum.io: tratar falhas de imagem com fallback visual (`onerror`)
- Erros da Hostinger API não devem quebrar a página — retornar entradas manuais normalmente
- Domínios com `status !== "active"` na Hostinger: ignorar
- `sites.json` nunca sobrescrito — sempre lido, modificado em memória, reescrito
- Sessão PHP com tempo de expiração: 2 horas (`session.gc_maxlifetime`)
- Senha do admin armazenada apenas como hash (`password_hash`) — nunca em texto puro
- Categorias e filtros são funcionalidade obrigatória, não opcional

---

## Ordem de Implementação

1. Estrutura de pastas + `.htaccess` raiz e `/api`
2. `config/config.php` (com valores placeholder)
3. `data/sites.json` (array vazio `[]`)
4. `api/sites.php` — integração Hostinger + merge com JSON
5. `api/admin/auth.php` — verificação de sessão
6. `api/admin/login.php` + `logout.php`
7. `api/admin/sites.php` — CRUD completo (com categoria)
8. `css/main.css` + `index.html` + `js/main.js` — portfólio Netflix com fileiras por categoria e filtros
9. `css/admin.css` + `admin.html` + `js/admin.js` — painel admin com gestão de categorias
10. Testes manuais (checklist abaixo)

---

## Checklist de Testes

- [ ] `GET /api/sites.php` retorna domínios Hostinger + entradas manuais
- [ ] Erro na Hostinger API → retorna só entradas manuais, sem quebrar
- [ ] Cards exibem screenshot via Thum.io corretamente
- [ ] Fallback visual funciona quando screenshot falha
- [ ] Sites são agrupados corretamente em fileiras por categoria
- [ ] Filtros por categoria, tipo e busca funcionam e são combináveis
- [ ] Click no card abre o site em nova aba
- [ ] Login com senha correta → acesso ao painel
- [ ] Login com senha errada → mensagem de erro, sem acesso
- [ ] Sessão expira após 2h
- [ ] CRUD admin: adicionar, editar, toggle ativo, excluir, com categoria
- [ ] `/config/config.php` retorna 403 via HTTP
- [ ] `/data/sites.json` retorna 403 via HTTP
- [ ] Layout responsivo: mobile, tablet, desktop
- [ ] `config.php` está no `.gitignore`

---

## Referências

- Hostinger API: https://developers.hostinger.com
- Hostinger API GitHub: https://github.com/hostinger/api
- Thum.io: https://thum.io
- Thum.io uso: `<img src="https://image.thum.io/get/width/600/https://url-do-site.com">`
