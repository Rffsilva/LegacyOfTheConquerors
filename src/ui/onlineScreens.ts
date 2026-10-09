// Screens for online campaigns: signing in with the access password, the list of your online
// campaigns, and the bar in an online barracks showing who's playing and the invite link.

import { inviteLink, readInvite, type KnownCampaign } from '../online/client.ts';
import type { OnlineCampaign } from '../online/onlineCampaign.ts';
import { h } from './dom.ts';

type Show = (...content: Node[]) => void;

export interface SignInOptions {
  name: string;
  notice?: string;
  signIn: (name: string, password: string) => Promise<void>;
  back: () => void;
}

export function showSignIn(show: Show, options: SignInOptions): void {
  const name = h('input', { value: options.name, maxLength: 24, autocomplete: 'username', placeholder: 'e.g. Ricardo' });
  const password = h('input', { type: 'password', autocomplete: 'current-password' });
  const status = h('p', { className: 'notice', role: 'status' }, options.notice ?? '');
  const submit = h('button', { className: 'pill primary', type: 'submit' }, 'Sign in');
  const form = h('form', {
    className: 'online-form',
    onsubmit: async (e: Event) => {
      e.preventDefault();
      if (!name.value.trim()) {
        status.textContent = 'Choose a name your friends will recognise.';
        return name.focus();
      }
      submit.disabled = true;
      status.textContent = 'Signing in…';
      try {
        await options.signIn(name.value.trim(), password.value);
      } catch (error) {
        status.textContent = (error as Error).message;
        submit.disabled = false;
        password.select();
      }
    },
  },
    h('label', { className: 'name' }, h('span', {}, 'Your name'), name),
    h('label', { className: 'name' }, h('span', {}, 'Password'), password),
    submit,
  );
  show(
    h('div', { className: 'menu online' },
      h('h1', {}, 'Online campaigns'),
      h('p', { className: 'tagline' }, 'Online play is for invited players. Enter the password you were given.'),
      status,
      form,
      h('button', { className: 'pill', onclick: options.back }, '‹ Back'),
    ),
  );
  (options.name ? password : name).focus();
}

export interface CampaignListOptions {
  name: string;
  campaigns: KnownCampaign[];
  notice?: string;
  open: (id: string) => void;
  create: (name: string, difficulty: number) => Promise<void>;
  join: (id: string, invite: string) => void;
  forget: (id: string) => void;
  signOut: () => void;
  back: () => void;
}

export function showCampaignList(show: Show, options: CampaignListOptions): void {
  const status = h('p', { className: 'notice', role: 'status' }, options.notice ?? '');

  let difficulty = 1;
  const difficultyButtons = ['Easy', 'Normal', 'Hard'].map((label, i) =>
    h('button', {
      type: 'button',
      className: `pill toggle${i === difficulty ? ' on' : ''}`,
      onclick: () => {
        difficulty = i;
        difficultyButtons.forEach((b, j) => b.classList.toggle('on', j === i));
      },
    }, label),
  );
  const title = h('input', { maxLength: 24, placeholder: 'Campaign name', value: `${options.name}'s campaign`.slice(0, 24) });
  const createButton = h('button', { className: 'pill primary', type: 'submit' }, 'Create');
  const create = h('form', {
    className: 'online-form',
    onsubmit: async (e: Event) => {
      e.preventDefault();
      createButton.disabled = true;
      status.textContent = 'Creating…';
      try {
        await options.create(title.value.trim(), difficulty);
      } catch (error) {
        status.textContent = (error as Error).message;
        createButton.disabled = false;
      }
    },
  },
    h('h2', {}, 'New online campaign'),
    title,
    h('div', { className: 'segmented', role: 'group', ariaLabel: 'Difficulty' }, ...difficultyButtons),
    createButton,
  );

  const link = h('input', { placeholder: 'Paste an invite link' });
  const join = h('form', {
    className: 'online-form',
    onsubmit: (e: Event) => {
      e.preventDefault();
      const invite = readInvite(link.value);
      if (invite) options.join(invite.id, invite.invite);
      else status.textContent = "That doesn't look like an invite link.";
    },
  },
    h('h2', {}, 'Join a friend'),
    link,
    h('button', { className: 'pill', type: 'submit' }, 'Join'),
  );

  const list = options.campaigns.length
    ? h('ul', { className: 'online-list' },
        ...options.campaigns.map((c) =>
          h('li', {},
            h('button', { className: 'pill primary', onclick: () => options.open(c.id) }, c.name),
            h('button', {
              className: 'icon small',
              ariaLabel: `Remove ${c.name} from this device`,
              title: 'Remove from this device (the campaign itself stays online)',
              onclick: () => confirm(`Remove "${c.name}" from this device? It stays online; an invite link brings it back.`) && options.forget(c.id),
            }, '✕'),
          ),
        ),
      )
    : h('p', { className: 'fineprint' }, 'No online campaigns on this device yet. Create one, or open an invite link from a friend.');

  show(
    h('div', { className: 'menu online' },
      h('h1', {}, 'Online campaigns'),
      h('p', { className: 'tagline' }, `Signed in as ${options.name}. `, h('button', { className: 'link', onclick: options.signOut }, 'Sign out')),
      status,
      list,
      create,
      join,
      h('p', { className: 'fineprint' }, 'Everyone keeps their own team and cash. Fields anyone opens up are open to all.'),
      h('button', { className: 'pill', onclick: options.back }, '‹ Main menu'),
    ),
  );
}

export function showConnecting(show: Show, message: string, back: () => void): void {
  show(h('div', { className: 'menu online' }, h('h1', {}, 'Online campaigns'), h('p', { className: 'tagline' }, message), h('button', { className: 'pill', onclick: back }, '‹ Back')));
}

/** The bar above an online barracks: connection, who's playing and where, and the invite link. */
export function presenceBar(campaign: OnlineCampaign): { element: HTMLElement; update: () => void } {
  const title = h('strong', { className: 'online-title' });
  const status = h('span', { className: 'online-status' });
  const members = h('ul', { className: 'online-members', ariaLabel: 'Players' });
  const invite = h('button', {
    className: 'pill small',
    onclick: async () => {
      const info = campaign.info;
      if (!info) return;
      const url = inviteLink(info.id, info.invite);
      const text = `Join my Legacy of the Conquerors campaign "${info.name}"`;
      try {
        if (navigator.share) await navigator.share({ title: info.name, text, url });
        else {
          await navigator.clipboard.writeText(url);
          invite.textContent = '✓ Link copied';
          window.setTimeout(() => (invite.textContent = '✉ Invite'), 2500);
        }
      } catch {
        // share sheet closed, or no clipboard access: show the link to copy by hand
        if (!navigator.share) prompt('Copy this invite link:', url);
      }
    },
    title: 'Share a link to this campaign. Friends also need the online password.',
  }, '✉ Invite');
  const element = h('section', { className: 'online-bar' },
    h('div', { className: 'online-bar-top' }, h('div', { className: 'online-heading' }, title, status), invite),
    members,
  );

  const update = () => {
    const unsent = campaign.unsent;
    const text: Record<OnlineCampaign['status'], string> = {
      connecting: 'Connecting…',
      online: 'Online',
      offline: 'Offline: reconnecting…',
      'signed-out': 'Signed out: open Online campaigns to sign in again',
      refused: campaign.refusal,
    };
    title.textContent = campaign.info?.name ?? '';
    status.textContent = `${text[campaign.status]}${unsent ? ` · ${unsent} battle${unsent > 1 ? 's' : ''} to send` : ''}`;
    status.dataset.status = campaign.status;
    members.replaceChildren(
      ...(campaign.info?.members ?? []).map((m) =>
        h('li', { className: m.online ? 'on' : '' },
          h('strong', {}, m.you ? `${m.name} (you)` : m.name),
          ` · ${m.online ? (m.where?.at === 'battle' ? `fighting on #${m.where.scenario}` : 'in the barracks') : 'away'}`,
          ` · ${m.teamSize} ${m.teamSize === 1 ? 'man' : 'men'}${m.topLevel ? `, best Lv ${m.topLevel}` : ''}`,
        ),
      ),
    );
  };
  update();
  return { element, update };
}
