# @ot/mod-skills

Skills for AI agents: prompt instructions written in `SKILL.md` files (Claude Code skill format), plus external skill packages installed from git repositories. When packages are installed, only `.md`/`.txt` text files and `LICENSE` are copied into `skills/_packages/<id>/`, never executing any scripts or git hooks.

## Install & Peer Dependencies

The module requires the following peer dependencies from the host environment:

```json
{
  "peerDependencies": {
    "@nestjs/common": "^11.0.0",
    "@tanstack/react-query": "^5.0.0",
    "lucide-react": ">=0.400.0",
    "react": "^19.0.0"
  }
}
```

Exports provided by package:
- `.` (Server): NestJS `SkillsModule.forRoot(options)`, `SkillCatalog`, `LocalSkillStore`, `SkillPackageStore`.
- `./contracts` (Contracts): Zod schemas and TypeScript types usable in both Node.js and browser environments.
- `./web` (Frontend): React components including `SkillsClientProvider`, `SkillsWorkspace`, `SkillEditor`, and `PackageList`.

## Server Setup

Register `SkillsModule.forRoot(...)` in your root NestJS application module:

```ts
import { SkillsModule, SkillCatalog } from '@ot/mod-skills';

@Module({
  imports: [
    SkillsModule.forRoot({
      rootDir: '/path/to/repo/root',
      skillsDir: 'skills', // optional, defaults to 'skills'
      usedBy: (prefix) => findReferencingWorkflows(prefix), // optional port
      logger: { info: (obj, msg) => console.log(msg, obj) }, // optional
    }),
  ],
})
export class AppModule {}
```

### Options (`SkillsModuleOptions`)

| Option | Type | Default | Description |
|---|---|---|---|
| `rootDir` | `string` | *(required)* | Folder containing the skills folder (e.g. repo root). |
| `skillsDir` | `string` | `'skills'` | Skills folder relative to `rootDir`. |
| `usedBy` | `(pathPrefix: string) => string[]` | `() => []` | Port function: returns ids of host entities (e.g. workflows) that reference a skill starting with this path prefix. |
| `logger` | `SkillsLogger` | NestJS logger | Custom logger interface with `info(obj, msg)`. |
| `fetcher` | `Fetcher` | `gitFetcher` | Function to clone and checkout git packages (swappable for testing). |

Other modules inject `SkillCatalog` directly to read skills:
- `catalog.get(path): Skill`: Returns skill path, name, description, body, and content hash (works for both local skills and package skills).
- `catalog.list(): SkillInfo[]`: Returns all skills (own + package) with current hashes for node pickers.

## HTTP API

Endpoints are mounted by `SkillsController` and `SkillPackagesController` (under host global prefix, e.g. `/api`):

| Method | Path | Description |
|---|---|---|
| `GET` | `/skills` | List the host's own skills (`SkillInfo[]`). |
| `POST` | `/skills` | Create a new local skill with starter frontmatter. |
| `GET` | `/skills/:name` | Read local skill content and hash (`SkillContent`). |
| `PUT` | `/skills/:name` | Update local skill content (`{ content: string }`). |
| `GET` | `/skill-packages` | List installed packages with categories and `usedBy` ids. |
| `POST` | `/skill-packages` | Install a git package (`{ source, ref?, id?, category? }`). |
| `GET` | `/skill-packages/skills` | List all package skills in picker shape (`PackageSkill[]`). |
| `GET` | `/skill-packages/:id/skills/:skill` | Read package skill content (`SkillContent`). |
| `POST` | `/skill-packages/:id/update` | Re-fetch the git repo and update package files. |
| `PATCH` | `/skill-packages/:id` | Update category (`{ category: string }`). |
| `DELETE` | `/skill-packages/:id?force=1` | Remove package (refuses if referenced by `usedBy` unless `force=1`). |

## Web UI

Wrap the workspace in `SkillsClientProvider` and provide an API adapter matching `SkillsClient`:

```tsx
import { SkillsClientProvider, SkillsWorkspace, type SkillsClient } from '@ot/mod-skills/web';

const client: SkillsClient = {
  fetchJson: async (path, init) => {
    const res = await fetch(`/api${path}`, init);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
};

export function SkillsPage() {
  return (
    <SkillsClientProvider client={client}>
      <SkillsWorkspace
        renderLocalExtras={({ name, dirty }) => (
          <div>Optional extra tools for skill {name}</div>
        )}
      />
    </SkillsClientProvider>
  );
}
```

### Tailwind CSS & Styling

If using Tailwind CSS v4 in the host app, add a `@source` directive in your main CSS file so Tailwind scans the module's components:

```css
@import "tailwindcss";
@source "path/to/node_modules/@ot/mod-skills/src/web";
```

The UI primitives rely on standard CSS design tokens (shadcn style):
- `--background`
- `--foreground`
- `--card`
- `--muted`
- `--muted-foreground`
- `--border`
- `--primary`
- `--primary-foreground`
- `--accent`

## Files on Disk

- `<rootDir>/<skillsDir>/<name>/SKILL.md`: Local skill definition with YAML frontmatter.
- `<rootDir>/<skillsDir>/packages.json`: External package registry and installed metadata.
- `<rootDir>/<skillsDir>/_packages/<id>/<skill>/SKILL.md`: Copied skills and `LICENSE` from external git packages.

## Security

- **Remote URL validation**: Only plain `https://` and `git@host:owner/repo` remote URLs are allowed (`checkSource`), blocking command injection vectors such as `ext::`, `file://`, or `--upload-pack`.
- **Sandboxed clone**: Git clones run with `-c core.hooksPath=/dev/null` and `--no-recurse-submodules` so untrusted repositories cannot run arbitrary hooks.
- **Strict file copy**: Only `.md` and `.txt` files under 512KB and top-level `LICENSE` files are copied; executables, scripts, and binaries are never extracted.
