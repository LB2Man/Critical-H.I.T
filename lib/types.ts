export const CONDITIONS = [
  "blinded",
  "charmed",
  "deafened",
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
export type ConditionName = Condition | "custom";
export type HpVisibility = "hideHpFromInvitees" | "hideAcFromInvitees";

export type ActiveCondition = {
  id: string;
  name: ConditionName;
  customName?: string;
  rounds?: number;
  expiresOnRound?: number;
};

export type Room = {
  id: string;
  name: string;
  creatorUid: string;
  creatorEmail: string;
  invitedEmails: string[];
  pendingInvitedEmails?: string[];
  round: number;
  activeCombatantId: string;
  hideHpFromInvitees: boolean;
  hideAcFromInvitees: boolean;
};

export type Combatant = {
  id: string;
  initiative: number;
  name: string;
  conditions: ActiveCondition[];
  concentrationPrompt?: {
    id: string;
    dc: number;
    ownerUid: string;
    fallbackUid: string;
  } | null;
  hp: number;
  maxHp: number;
  ac: number;
  exhaustionLevel: number;
  ownerUid: string;
  ownerEmail: string;
  type: "player" | "npc";
  order: number;
};

export function conditionLabel(condition: Condition) {
  return condition
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function activeConditionLabel(condition: ActiveCondition) {
  if (condition.name === "custom") return condition.customName || "Custom";
  return conditionLabel(condition.name);
}

export function normalizeConditions(conditions: unknown): ActiveCondition[] {
  if (!Array.isArray(conditions)) return [];

  return conditions
    .map((condition) => {
      if (typeof condition === "string" && CONDITIONS.includes(condition as Condition)) {
        return {
          id: `${condition}-${crypto.randomUUID()}`,
          name: condition as Condition,
        };
      }

      if (
        condition &&
        typeof condition === "object" &&
        "name" in condition &&
        (CONDITIONS.includes((condition as { name: Condition }).name) ||
          (condition as { name: string }).name === "custom")
      ) {
        const active = condition as ActiveCondition;
        const normalized: ActiveCondition = {
          id: active.id || `${active.name}-${crypto.randomUUID()}`,
          name: active.name,
        };

        if (typeof active.customName === "string" && active.customName.trim()) {
          normalized.customName = active.customName.trim();
        }

        if (typeof active.rounds === "number" && active.rounds > 0) {
          normalized.rounds = active.rounds;
        }

        if (typeof active.expiresOnRound === "number" && active.expiresOnRound > 0) {
          normalized.expiresOnRound = active.expiresOnRound;
        }

        return normalized;
      }

      return null;
    })
    .filter((condition): condition is ActiveCondition => Boolean(condition));
}

export function hiddenHpStatus(hp: number, maxHp: number) {
  if (hp <= 0) return "Down";
  if (maxHp > 0 && hp <= maxHp / 2) return "Bloodied";
  return "Healthy";
}
