import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChippiHost } from '../lib/chippi-host';
const state = vi.hoisted(() => ({ host: null as ChippiHost | null }));
vi.mock('../lib/chippi-host', () => ({ chippiHost: () => state.host }));
vi.mock('react-router-dom', () => ({ useLocation: () => ({ pathname: '/app', search: '' }) }));
import { ChippiNavigation } from './ChippiNavigation';
beforeEach(() => { state.host = { kind: 'team', basePath: '/workforce/team/team-a', apiBase: '/api/workforce/team/team-a', crmHref: '/teams', name: 'Harbor team', role: 'Team member', workspaces: [
  { kind: 'personal', href: '/workforce/personal/solo/app', name: 'My business', role: 'Agent workspace' },
  { kind: 'team', href: '/workforce/team/team-a/app', name: 'Harbor team', role: 'Team member' },
  { kind: 'brokerage', href: '/workforce/brokerage/broker-a/app', name: 'Harbor brokerage', role: 'Brokerage admin' },
] }; });
describe('hosted workspace identity', () => {
  it('groups named contexts and selects the exact team workspace', () => {
    const html = renderToStaticMarkup(<ChippiNavigation />);
    expect(html).toContain('label="Agent workspace"');
    expect(html).toContain('label="Teams"');
    expect(html).toContain('label="Brokerages"');
    expect(html).toMatch(/value="\/workforce\/team\/team-a\/app" selected=""/);
  });
  it('does not advertise a team CRM when the destination is team management', () => {
    const html = renderToStaticMarkup(<ChippiNavigation />);
    expect(html).toContain('Manage teams');
    expect(html).not.toContain('>CRM<');
  });
  it('retains CRM and Workforce navigation in an agent workspace', () => {
    state.host!.kind = 'personal';
    expect(renderToStaticMarkup(<ChippiNavigation />)).toContain('>CRM</a>');
  });
});
