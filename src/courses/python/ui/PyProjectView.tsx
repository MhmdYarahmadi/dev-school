import type { Project } from '../../../content/types';

/** The Python course has no open-ended projects yet; this satisfies the CourseUI contract. */
export function PyProjectView({ project }: { project: Project }) {
  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>{project.title}</h2>
      <p className="muted">این پروژه هنوز آماده نیست.</p>
    </div>
  );
}
