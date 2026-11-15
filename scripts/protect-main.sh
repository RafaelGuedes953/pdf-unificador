#!/usr/bin/env bash
# Protege a branch main do repositório: só entra código por pull request, com o CI verde.
#
# Uso:
#   scripts/protect-main.sh                      # detecta o repositório pela pasta atual
#   scripts/protect-main.sh usuario/pdf-unificador
#
# Opções (variáveis de ambiente):
#   REQUIRED_APPROVALS  aprovações exigidas no PR (padrão: 0, veja o aviso abaixo)
#   ENFORCE_ADMINS      true/false: aplica as regras também a administradores (padrão: true)
#   BRANCH              branch a proteger (padrão: main)
#   CHECKS              checks obrigatórios, separados por vírgula (padrão: build-test,docker-build)
#   DRY_RUN=1           só mostra o que seria enviado, sem alterar nada
#
# AVISO sobre aprovações: o GitHub não conta a aprovação do próprio autor do PR.
# Se você é a única pessoa no repositório e abre os PRs com a sua conta, exigir 1 aprovação
# trava os seus próprios merges. Nesse caso, o seu clique em "Merge" é a aprovação, e a
# proteção garante que isso só aconteça via PR e com o CI passando.
# Se os PRs forem abertos por OUTRA conta (um bot, um colega), use REQUIRED_APPROVALS=1:
# aí o PR só entra depois que você aprovar (e a revisão de code owner passa a ser exigida).
#
# Requisitos: GitHub CLI (gh) autenticado com permissão de administrador no repositório.
# Em repositórios privados, a proteção de branch pode exigir plano pago do GitHub.

set -euo pipefail

BRANCH="${BRANCH:-main}"
APPROVALS="${REQUIRED_APPROVALS:-0}"
ENFORCE_ADMINS="${ENFORCE_ADMINS:-true}"
CHECKS="${CHECKS:-build-test,docker-build}"

if ! [[ "$APPROVALS" =~ ^[0-9]+$ ]]; then
  echo "REQUIRED_APPROVALS deve ser um número inteiro (recebi: $APPROVALS)" >&2
  exit 1
fi
if [[ "$ENFORCE_ADMINS" != "true" && "$ENFORCE_ADMINS" != "false" ]]; then
  echo "ENFORCE_ADMINS deve ser true ou false (recebi: $ENFORCE_ADMINS)" >&2
  exit 1
fi

CODEOWNERS_REQUIRED=false
if [[ "$APPROVALS" -ge 1 ]]; then
  CODEOWNERS_REQUIRED=true
fi

# Monta o array JSON dos checks sem depender de jq.
contexts=""
IFS=',' read -ra check_list <<< "$CHECKS"
for check in "${check_list[@]}"; do
  check="${check// /}"
  [[ -z "$check" ]] && continue
  contexts+="${contexts:+, }\"$check\""
done

payload=$(cat <<JSON
{
  "required_status_checks": { "strict": true, "contexts": [ $contexts ] },
  "enforce_admins": $ENFORCE_ADMINS,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": $CODEOWNERS_REQUIRED,
    "required_approving_review_count": $APPROVALS
  },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true
}
JSON
)

if [[ "${DRY_RUN:-}" == "1" ]]; then
  echo "[dry-run] PUT repos/<repo>/branches/$BRANCH/protection"
  echo "$payload"
  exit 0
fi

command -v gh >/dev/null 2>&1 || { echo "GitHub CLI (gh) não encontrado. Instale em https://cli.github.com" >&2; exit 1; }

repo="${1:-}"
if [[ -z "$repo" ]]; then
  repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
fi

echo "Aplicando proteção em $repo (branch $BRANCH)..."
echo "$payload" | gh api --method PUT "repos/$repo/branches/$BRANCH/protection" --input - >/dev/null

echo "Pronto. Regras ativas:"
gh api "repos/$repo/branches/$BRANCH/protection" --jq '
  "  - PR obrigatório; aprovações exigidas: \(.required_pull_request_reviews.required_approving_review_count)",
  "  - revisão de code owner: \(.required_pull_request_reviews.require_code_owner_reviews)",
  "  - checks obrigatórios: \(.required_status_checks.contexts | join(", "))",
  "  - branch atualizada antes do merge: \(.required_status_checks.strict)",
  "  - vale também para administradores: \(.enforce_admins.enabled)",
  "  - push direto, force push e exclusão: bloqueados"'

if [[ "$APPROVALS" -eq 0 ]]; then
  echo
  echo "Obs.: aprovações exigidas = 0. O merge precisa ser feito por PR com o CI verde,"
  echo "mas qualquer pessoa com permissão de escrita pode clicar em Merge. Para exigir a sua"
  echo "aprovação de outra conta, rode com REQUIRED_APPROVALS=1 (veja o aviso no topo do script)."
fi
