// Screens for online campaigns: signing in with the access password, the list of your online
// campaigns, and the bar in an online barracks showing who's playing and the invite link.

import { ARENA_FIELD, isArena } from '../game/arena.ts';
import { inviteLink, readInvite, type KnownCampaign } from '../online/client.ts';
import type { OnlineCampaign } from '../online/onlineCampaign.ts';
import { formatNumber, h } from './dom.ts';

type Show = (...content: Node[]) => void;

export interface SignInOptions {
  name: string;
  notice?: string;
  /** Ask for the online password (a device that is still signed in doesn't need it again). */
  needPassword: boolean;
  signIn: (username: string, code: string, password: string) => Promise<void>;
  back: () => void;
}

/**
 * Signing in with a username and a personal code: the same ones on any device bring back your
 * campaigns. A username nobody has yet makes a new account.
 */
export function showSignIn(show: Show, options: SignInOptions): void {
  const name = h('input', { value: options.name, maxLength: 20, autocomplete: 'username', placeholder: 'e.g. Ricardo' });
  const code = h('input', { type: 'password', maxLength: 64, autocomplete: 'current-password', placeholder: 'at least 4 characters' });
  const password = h('input', { type: 'password', autocomplete: 'off' });
  const status = h('p', { className: 'notice', role: 'status' }, options.notice ?? '');
  const submit = h('button', { className: 'pill primary', type: 'submit' }, 'Sign in');
  const form = h('form', {
    className: 'online-form',
    onsubmit: async (e: Event) => {
      e.preventDefault();
      if (!name.value.trim()) {
        status.textContent = 'Choose a username your friends will recognise.';
        return name.focus();
      }
      submit.disabled = true;
      status.textContent = 'Signing in…';
      try {
        await options.signIn(name.value.trim(), code.value, password.value);
      } catch (error) {
        status.textContent = (error as Error).message;
        submit.disabled = false;
      }
    },
  },
    h('label', { className: 'name' }, h('span', {}, 'Username'), name),
    h('label', { className: 'name' }, h('span', {}, 'Your code'), code),
    options.needPassword && h('label', { className: 'name' }, h('span', {}, 'Online password'), password),
    submit,
  );
  show(
    h('div', { className: 'menu online' },
      h('h1', {}, 'Online campaigns'),
      h('p', { className: 'tagline' },
        'Use the same username and code on any device to get your campaigns there. New here? Pick a username and a code you\'ll remember',
        options.needPassword ? ', plus the online password you were given.' : '.',
      ),
      status,
      form,
      h('button', { className: 'pill', onclick: options.back }, '‹ Back'),
    ),
  );
  (options.name ? code : name).focus();
}

export interface CampaignListOptions {
  name: string;
  campaigns: KnownCampaign[];
  notice?: string;
  open: (id: string) => void;
  create: (name: string, difficulty: number) => Promise<void>;
  join: (id: string, invite: string) => void;
  forget: (id: string) => void;
  logOff: () => void;
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
              ariaLabel: `Remove ${c.name} from your list`,
              title: 'Remove from your list (the campaign itself stays online)',
              onclick: () => confirm(`Remove "${c.name}" from your list, on all your devices? The campaign stays online; an invite link brings it back.`) && options.forget(c.id),
            }, '✕'),
          ),
        ),
      )
    : h('p', { className: 'fineprint' }, 'No online campaigns on this device yet. Create one, or open an invite link from a friend.');

  show(
    h('div', { className: 'menu online' },
      h('h1', {}, 'Online campaigns'),
      h('div', { className: 'signed-in' },
        h('span', {}, 'Signed in as ', h('strong', {}, options.name)),
        h('button', {
          className: 'pill small',
          onclick: () => confirm('Log off on this device? Your campaigns stay saved online: sign in again with your username and code to get them back.') && options.logOff(),
        }, '🚪 Log off'),
      ),
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
  const bank = bankPanel(campaign);
  const bankButton = h('button', {
    className: 'pill small',
    ariaExpanded: 'false',
    onclick: () => {
      bank.element.hidden = !bank.element.hidden;
      bankButton.ariaExpanded = String(!bank.element.hidden);
      if (!bank.element.hidden) bank.focus();
    },
    title: 'The campaign bank: put in cash for your friends, or take some out.',
  });
  const element = h('section', { className: 'online-bar' },
    h('div', { className: 'online-bar-top' }, h('div', { className: 'online-heading' }, title, status), h('div', { className: 'online-actions' }, bankButton, invite)),
    bank.element,
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
    bankButton.textContent = `🏦 Bank ${formatNumber(campaign.info?.bank ?? 0)}`;
    bank.update();
    status.textContent = `${text[campaign.status]}${unsent ? ` · ${unsent} battle${unsent > 1 ? 's' : ''} to send` : ''}`;
    status.dataset.status = campaign.status;
    members.replaceChildren(
      ...(campaign.info?.members ?? []).map((m) =>
        h('li', { className: m.online ? 'on' : '' },
          h('strong', {}, m.you ? `${m.name} (you)` : m.name),
          ` · ${m.online ? (m.where?.at === 'battle' ? (isArena(m.where.scenario) ? 'in the arena' : `fighting on #${m.where.scenario}`) : m.ready ? '✓ ready' : 'in the barracks') : m.inBattle ? 'away (squad still fighting)' : 'away'}`,
          ` · ${m.teamSize} ${m.teamSize === 1 ? 'man' : 'men'}${m.topLevel ? `, best Lv ${m.topLevel}` : ''}`,
        ),
      ),
    );
  };
  update();
  return { element, update };
}

/**
 * The campaign bank, opened from the online bar: put cash in or take it out, and see who did
 * what lately. Everyone in the campaign shares it.
 */
function bankPanel(campaign: OnlineCampaign): { element: HTMLElement; update: () => void; focus: () => void } {
  const balance = h('strong', {});
  const amount = h('input', { type: 'number', min: '1', step: '1', inputMode: 'numeric', placeholder: 'Amount', ariaLabel: 'Amount' });
  const status = h('p', { className: 'bank-status', role: 'status' });
  const log = h('ul', { className: 'bank-log', ariaLabel: 'Latest deposits and withdrawals' });
  const move = (sign: 1 | -1) => {
    const n = Math.trunc(Number(amount.value));
    if (!(n > 0)) {
      status.textContent = 'Type an amount first.';
      return amount.focus();
    }
    const result = campaign.bank(sign * n);
    status.textContent = result.ok ? (sign > 0 ? `You put ${formatNumber(n)} in the bank.` : `You took ${formatNumber(n)} out.`) : result.reason ?? '';
    if (result.ok) amount.value = '';
  };
  // Enter (the form's submit) puts in; the other buttons mustn't submit it too.
  const deposit = h('button', { className: 'pill primary', type: 'submit' }, 'Put in');
  const withdraw = h('button', { className: 'pill', type: 'button', onclick: () => move(-1) }, 'Take out');
  const all = h('button', {
    className: 'pill small',
    type: 'button',
    onclick: () => {
      amount.value = String(campaign.view.money);
      amount.focus();
    },
    title: 'All your cash',
  }, 'All mine');
  const element = h('div', { className: 'bank', hidden: true },
    h('p', { className: 'bank-balance' }, 'Campaign bank: ', balance, h('span', {}, ' · shared by everyone in the campaign')),
    h('form', { className: 'bank-move', onsubmit: (e: Event) => (e.preventDefault(), move(1)) }, amount, all, deposit, withdraw),
    status,
    log,
  );

  const update = () => {
    const info = campaign.info;
    balance.textContent = formatNumber(info?.bank ?? 0);
    const online = campaign.status === 'online' && !campaign.me?.inBattle;
    for (const button of [deposit, withdraw, all]) button.disabled = !online;
    log.replaceChildren(
      ...(info?.bankLog ?? []).slice(0, 6).map((entry) =>
        h('li', {},
          h('strong', {}, entry.name),
          entry.amount > 0 ? ` put in ${formatNumber(entry.amount)}` : ` took out ${formatNumber(-entry.amount)}`,
          h('span', { className: 'when' }, ` · ${timeAgo(entry.at)}`),
        ),
      ),
    );
    if (!info?.bankLog.length) log.replaceChildren(h('li', {}, 'Nobody has used the bank yet.'));
  };
  update();
  return { element, update, focus: () => amount.focus() };
}

function timeAgo(at: number): string {
  const minutes = Math.round((Date.now() - at) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days > 1 ? 's' : ''} ago`;
}

/**
 * The ready-up lobby under an online barracks: the field everyone is getting ready for (anyone
 * can change it), and the button that says you're ready, or joins the battle being fought.
 */
export function lobbyBar(campaign: OnlineCampaign, fieldTitle: (n: number) => string): { element: HTMLElement; update: () => void } {
  const picker = h('select', {
    className: 'picker',
    ariaLabel: 'Field to fight on',
    onchange: () => campaign.chooseField(Number(picker.value)),
  });
  const button = h('button', {
    className: 'pill primary',
    onclick: () => {
      const info = campaign.info;
      if (info?.battle) campaign.joinBattle();
      else campaign.ready(!campaign.me?.ready);
    },
  });
  const status = h('p', { className: 'lobby-status' });
  const element = h('footer', { className: 'barracks-bottom lobby' },
    h('label', { className: 'field' }, h('span', {}, 'Next field'), picker),
    button,
    status,
  );

  const update = () => {
    const info = campaign.info;
    const me = campaign.me;
    if (!info) return;
    const open = [...(info.open ?? [1]), ARENA_FIELD];
    const field = info.field ?? Math.max(...open);
    picker.replaceChildren(...open.map((n) => new Option(`${fieldTitle(n)}${campaign.view.completed.includes(n) ? ' (won)' : ''}`, String(n), false, n === field)));
    picker.disabled = !!info.battle || campaign.status !== 'online';
    button.disabled = campaign.status !== 'online' || (!info.battle && !campaign.view.team.length);
    button.classList.toggle('on', !info.battle && !!me?.ready);

    const here = info.members.filter((m) => m.online && m.where?.at === 'barracks');
    if (info.battle) {
      button.textContent = me?.inBattle ? '⚔ Back to the battle' : isArena(info.battle.scenario) ? '⚔ Join the arena' : `⚔ Join the battle on #${info.battle.scenario}`;
      status.textContent = `${info.battle.playing.join(', ') || 'Nobody'} ${info.battle.playing.length === 1 ? 'is' : 'are'} fighting on ${fieldTitle(info.battle.scenario)}.`;
    } else {
      button.textContent = me?.ready ? '✓ Ready (tap to cancel)' : '✋ Ready';
      const waiting = here.filter((m) => !m.ready).map((m) => (m.you ? 'you' : m.name));
      status.textContent = !campaign.view.team.length
        ? 'Hire someone to go to battle.'
        : waiting.length
          ? `The battle starts when everyone in the barracks is ready. Waiting for: ${waiting.join(', ')}.`
          : 'Starting…';
    }
  };
  update();
  return { element, update };
}
