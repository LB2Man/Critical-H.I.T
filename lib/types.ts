export const CONDITIONS = [
  "blinded",
  "charmed",
  "deafened",
  "exhaustion-1",
  "exhaustion-2",
  "exhaustion-3",
  "exhaustion-4",
  "exhaustion-5",
  "exhaustion-6",
  "grappled",
  "frightened",
  "incapacitated",
  "invisible",
  "paralyzed",
  "petrified",
  "poisoned",
  "restrained",
  "stunned",
  "concentration",
] as const;

export type Condition = (typeof CONDITIONS)[number];
export type HpVisibility = "hideHpFromInvitees" | "hideAcFromInvitees";

export type Room = {
  id: string;
  name: string;
  creatorUid: string;
  creatorEmail: string;
  invitedEmails: string[];
  round: number;
  activeCombatantId: string;
  hideHpFromInvitees: boolean;
  hideAcFromInvitees: boolean;
};

export type Combatant = {
  id: string;
  initiative: number;
  name: string;
  conditions: Condition[];
  hp: number;
  maxHp: number;
  ac: number;
  ownerUid: string;
  ownerEmail: string;
  type: "player" | "npc";
  order: number;
};

export function conditionLabel(condition: Condition) {
  if (condition.startsWith("exhaustion-")) {
    return `Exhaustion Level ${condition.at(-1)}`;
  }

  return condition
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function hiddenHpStatus(hp: number, maxHp: number) {
  if (hp <= 0) return "Down";
  if (maxHp > 0 && hp <= maxHp / 2) return "Bloodied";
  return "Healthy";
}
