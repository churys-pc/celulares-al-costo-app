import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { RepoChip } from './QuickAdd.tsx';

export function RepoSection() {
  const [st, setSt] = useState<Awaited<ReturnType<typeof api.repoStatus>> | null>(null);
  const [repo, setRepo] = useState(''); const [token, setToken] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { api.repoStatus().then((s) => { setSt(s); setRepo(s.repo); }).catch(() => {}); }, []);
  async function save() {
    setError('');
    try { setSt(await api.repoSave({ repo, ...(token ? { token } : {}) })); setToken(''); setSt(await api.repoSync()); } catch (e) { setError((e as Error).message); }
  }
  return (
    <div className="section"><h2>Repositorio de datos (GitHub)</h2>
      <p className="muted small" style={{ marginTop: 0 }}>Los productos cargados se guardan en este repo privado y se comparten entre todas las PCs del local. {st?.builtin ? ' Esta PC se conecta sola con la clave incluida en la app; solo pegá una clave si querés usar otra.' : ' La clave se guarda cifrada en esta PC.'}</p>
      <div className="form">
        <label>Repositorio<input className="input" value={repo} onChange={(e) => setRepo(e.target.value)} /></label>
        <label>Clave de GitHub {st?.hasToken && <span className="badge st-aprobado">{st.builtin ? 'automática' : 'guardada'}</span>}
          <input className="input" type="password" autoComplete="off" value={token} placeholder={st?.builtin ? 'Opcional (se usa la clave automática)' : st?.hasToken ? '•••••• (dejar vacío para mantener)' : 'github_pat_…'} onChange={(e) => setToken(e.target.value)} /></label>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn primary" onClick={save}>Guardar y sincronizar</button>
        {st && <RepoChip st={st} onSync={async () => setSt(await api.repoSync())} />}
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
