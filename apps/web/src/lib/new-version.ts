// Après un déploiement, les fichiers JavaScript de l'ancienne version n'existent plus sur le serveur :
// un onglet ouvert avant la mise en ligne échoue en chargeant une page (404) et affichait une page
// blanche. On recharge alors une seule fois pour récupérer la nouvelle version ; le garde-fou en
// sessionStorage évite une boucle de rechargements si l'échec a une autre cause (réseau coupé).
const KEY = "nour_reloaded_for_new_version";

export const reloadOnceForNewVersion = () => {
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < 30_000) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch { return false; }
  window.location.reload();
  return true;
};
