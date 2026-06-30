"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  addDoc,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { onAuthStateChanged, signInWithPopup, signOut, User } from "firebase/auth";
import {
  ChevronRight,
  GripVertical,
  LogOut,
  Plus,
  RotateCcw,
  Shield,
  Skull,
  SortDesc,
  Trash2,
  Users,
} from "lucide-react";
import { auth, db, firebaseReady, googleProvider } from "../lib/firebase";
import {
  Combatant,
  Condition,
  HpVisibility,
  Room,
  CONDITIONS,
  conditionLabel,
  hiddenHpStatus,
} from "../lib/types";

type View = "rooms" | "room";

const numberOrZero = (value: FormDataEntryValue | null) => Number(value || 0);

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [view, setView] = useState<View>("rooms");

  useEffect(() => {
    if (!firebaseReady) {
      setAuthLoading(false);
      return;
    }

    return onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      setAuthLoading(false);

      if (nextUser?.email) {
        await setDoc(
          doc(db, "users", nextUser.uid),
          {
            uid: nextUser.uid,
            email: nextUser.email,
            displayName: nextUser.displayName || nextUser.email,
            photoURL: nextUser.photoURL || "",
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
      }
    });
  }, []);

  useEffect(() => {
    if (!user?.email || !firebaseReady) {
      setRooms([]);
      return;
    }

    const createdQuery = query(collection(db, "rooms"), where("creatorUid", "==", user.uid));
    const invitedQuery = query(collection(db, "rooms"), where("invitedEmails", "array-contains", user.email));

    const roomMap = new Map<string, Room>();
    const publish = () =>
      setRooms(
        Array.from(roomMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
      );

    const unsubscribeCreated = onSnapshot(createdQuery, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === "removed") {
          roomMap.delete(change.doc.id);
        } else {
          roomMap.set(change.doc.id, { id: change.doc.id, ...change.doc.data() } as Room);
        }
      });
      publish();
    });

    const unsubscribeInvited = onSnapshot(invitedQuery, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === "removed") {
          roomMap.delete(change.doc.id);
        } else {
          roomMap.set(change.doc.id, { id: change.doc.id, ...change.doc.data() } as Room);
        }
      });
      publish();
    });

    return () => {
      unsubscribeCreated();
      unsubscribeInvited();
    };
  }, [user]);

  const activeRoom = useMemo(
    () => rooms.find((room) => room.id === activeRoomId) || null,
    [activeRoomId, rooms],
  );

  async function handleSignIn() {
    if (!firebaseReady) return;
    await signInWithPopup(auth, googleProvider);
  }

  async function handleCreateRoom(formData: FormData) {
    if (!user?.email) return;

    const name = String(formData.get("roomName") || "").trim();
    if (!name) return;

    const roomRef = await addDoc(collection(db, "rooms"), {
      name,
      creatorUid: user.uid,
      creatorEmail: user.email,
      invitedEmails: [],
      round: 1,
      activeCombatantId: "",
      hideHpFromInvitees: false,
      hideAcFromInvitees: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    setActiveRoomId(roomRef.id);
    setView("room");
  }

  if (!firebaseReady) {
    return <MissingFirebaseConfig />;
  }

  if (authLoading) {
    return <Shell title="Critical H.I.T" subtitle="Opening the war room..." />;
  }

  if (!user) {
    return <SignInScreen onSignIn={handleSignIn} />;
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setView("rooms")}>
          <Skull aria-hidden="true" />
          <span>Critical H.I.T</span>
        </button>
        <div className="profile">
          <span>{user.displayName || user.email}</span>
          <button className="icon-button" title="Sign out" onClick={() => signOut(auth)}>
            <LogOut aria-hidden="true" />
          </button>
        </div>
      </header>

      {view === "rooms" ? (
        <RoomsView
          rooms={rooms}
          user={user}
          onCreateRoom={handleCreateRoom}
          onOpenRoom={(roomId) => {
            setActiveRoomId(roomId);
            setView("room");
          }}
        />
      ) : activeRoom ? (
        <RoomView room={activeRoom} user={user} onBack={() => setView("rooms")} />
      ) : (
        <RoomsView
          rooms={rooms}
          user={user}
          onCreateRoom={handleCreateRoom}
          onOpenRoom={(roomId) => {
            setActiveRoomId(roomId);
            setView("room");
          }}
        />
      )}
    </main>
  );
}

function Shell({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <main className="center-screen">
      <div className="sigil">
        <Skull aria-hidden="true" />
      </div>
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </main>
  );
}

function MissingFirebaseConfig() {
  return (
    <Shell
      title="Firebase Config Needed"
      subtitle="Add your Firebase values to .env.local using .env.local.example, then restart the app."
    />
  );
}

function SignInScreen({ onSignIn }: { onSignIn: () => void }) {
  return (
    <main className="center-screen">
      <div className="sigil">
        <Skull aria-hidden="true" />
      </div>
      <h1>Critical H.I.T</h1>
      <p>Sign in with Google to enter your combat rooms.</p>
      <button className="primary-action" onClick={onSignIn}>
        <Shield aria-hidden="true" />
        Sign in with Google
      </button>
    </main>
  );
}

function RoomsView({
  rooms,
  user,
  onCreateRoom,
  onOpenRoom,
}: {
  rooms: Room[];
  user: User;
  onCreateRoom: (formData: FormData) => void;
  onOpenRoom: (roomId: string) => void;
}) {
  return (
    <section className="room-list-page">
      <div className="page-heading">
        <p className="eyebrow">War Rooms</p>
        <h1>Choose a combat room</h1>
      </div>

      <form className="create-room" action={onCreateRoom}>
        <input name="roomName" placeholder="Room name" aria-label="Room name" />
        <button className="primary-action" type="submit">
          <Plus aria-hidden="true" />
          Create Room
        </button>
      </form>

      <div className="rooms-grid">
        {rooms.map((room) => (
          <button className="room-card" key={room.id} onClick={() => onOpenRoom(room.id)}>
            <Users aria-hidden="true" />
            <span>{room.name}</span>
            <small>{room.creatorUid === user.uid ? "Creator" : "Invited"}</small>
          </button>
        ))}
        {rooms.length === 0 && (
          <div className="empty-state">Create your first room to start tracking combat.</div>
        )}
      </div>
    </section>
  );
}

function RoomView({ room, user, onBack }: { room: Room; user: User; onBack: () => void }) {
  const isCreator = room.creatorUid === user.uid;
  const [combatants, setCombatants] = useState<Combatant[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");

  useEffect(() => {
    const combatantsQuery = query(
      collection(db, "rooms", room.id, "combatants"),
      orderBy("order", "asc"),
    );

    return onSnapshot(combatantsQuery, (snapshot) => {
      setCombatants(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Combatant));
    });
  }, [room.id]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function addInvite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = inviteEmail.trim().toLowerCase();
    if (!email || !isCreator) return;

    await updateDoc(doc(db, "rooms", room.id), {
      invitedEmails: arrayUnion(email),
      updatedAt: serverTimestamp(),
    });
    setInviteEmail("");
  }

  async function addCombatant() {
    if (!user.email) return;
    const order = combatants.length ? Math.max(...combatants.map((item) => item.order)) + 1 : 0;
    const isPlayer = !isCreator;

    const newRef = await addDoc(collection(db, "rooms", room.id, "combatants"), {
      initiative: 0,
      name: isPlayer ? `${user.displayName || "Player"}'s character` : "New combatant",
      conditions: [],
      hp: 10,
      maxHp: 10,
      ac: 10,
      ownerUid: isPlayer ? user.uid : "",
      ownerEmail: isPlayer ? user.email : "",
      type: isPlayer ? "player" : "npc",
      order,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    if (!room.activeCombatantId && combatants.length === 0) {
      await updateDoc(doc(db, "rooms", room.id), {
        activeCombatantId: newRef.id,
        updatedAt: serverTimestamp(),
      });
    }
  }

  async function updateCombatant(id: string, patch: Partial<Combatant>) {
    await updateDoc(doc(db, "rooms", room.id, "combatants", id), {
      ...patch,
      updatedAt: serverTimestamp(),
    });
  }

  async function removeCombatant(id: string) {
    if (!isCreator) return;
    await deleteDoc(doc(db, "rooms", room.id, "combatants", id));

    if (room.activeCombatantId === id) {
      const remaining = combatants.filter((item) => item.id !== id);
      await updateDoc(doc(db, "rooms", room.id), {
        activeCombatantId: remaining[0]?.id || "",
        updatedAt: serverTimestamp(),
      });
    }
  }

  async function sortByInitiative() {
    if (!isCreator) return;
    const sorted = [...combatants].sort((a, b) => b.initiative - a.initiative);
    const batch = writeBatch(db);

    sorted.forEach((combatant, index) => {
      batch.update(doc(db, "rooms", room.id, "combatants", combatant.id), {
        order: index,
        updatedAt: serverTimestamp(),
      });
    });

    batch.update(doc(db, "rooms", room.id), {
      activeCombatantId: sorted[0]?.id || "",
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  }

  async function handleNext() {
    if (!isCreator || combatants.length === 0) return;
    const currentIndex = Math.max(
      combatants.findIndex((combatant) => combatant.id === room.activeCombatantId),
      0,
    );
    const nextIndex = currentIndex + 1;
    const isNewRound = nextIndex >= combatants.length;

    await updateDoc(doc(db, "rooms", room.id), {
      activeCombatantId: isNewRound ? combatants[0].id : combatants[nextIndex].id,
      round: isNewRound ? room.round + 1 : room.round,
      updatedAt: serverTimestamp(),
    });
  }

  async function resetRound() {
    if (!isCreator) return;
    await updateDoc(doc(db, "rooms", room.id), {
      round: 1,
      activeCombatantId: combatants[0]?.id || "",
      updatedAt: serverTimestamp(),
    });
  }

  async function handleDragEnd(event: DragEndEvent) {
    if (!isCreator) return;

    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = combatants.findIndex((combatant) => combatant.id === active.id);
    const newIndex = combatants.findIndex((combatant) => combatant.id === over.id);
    const reordered = arrayMove(combatants, oldIndex, newIndex);
    const batch = writeBatch(db);

    reordered.forEach((combatant, index) => {
      batch.update(doc(db, "rooms", room.id, "combatants", combatant.id), {
        order: index,
        updatedAt: serverTimestamp(),
      });
    });

    await batch.commit();
  }

  async function toggleVisibility(field: HpVisibility) {
    if (!isCreator) return;
    await updateDoc(doc(db, "rooms", room.id), {
      [field]: !room[field],
      updatedAt: serverTimestamp(),
    });
  }

  return (
    <section className="room-page">
      <div className="room-header">
        <button className="subtle-button" onClick={onBack}>
          Rooms
        </button>
        <div>
          <p className="eyebrow">Initiative</p>
          <h1>{room.name}</h1>
        </div>
        <div className="round-display">Round {room.round}</div>
      </div>

      <nav className="tabs" aria-label="Room tools">
        <button className="tab active">Initiative</button>
        <button className="tab" disabled>
          Coming next
        </button>
      </nav>

      <div className="tracker-toolbar">
        <button className="primary-action" onClick={handleNext} disabled={!isCreator}>
          <ChevronRight aria-hidden="true" />
          Next
        </button>
        <button className="tool-button" onClick={sortByInitiative} disabled={!isCreator}>
          <SortDesc aria-hidden="true" />
          Sort
        </button>
        <button className="tool-button" onClick={addCombatant}>
          <Plus aria-hidden="true" />
          Add
        </button>
        <button className="tool-button" onClick={resetRound} disabled={!isCreator}>
          <RotateCcw aria-hidden="true" />
          Reset Round
        </button>
        {isCreator && (
          <>
            <button className="toggle-button" onClick={() => toggleVisibility("hideHpFromInvitees")}>
              HP: {room.hideHpFromInvitees ? "Status" : "Visible"}
            </button>
            <button className="toggle-button" onClick={() => toggleVisibility("hideAcFromInvitees")}>
              AC: {room.hideAcFromInvitees ? "Hidden" : "Visible"}
            </button>
          </>
        )}
      </div>

      {isCreator && (
        <form className="invite-bar" onSubmit={addInvite}>
          <input
            value={inviteEmail}
            onChange={(event) => setInviteEmail(event.target.value)}
            placeholder="Invite by registered email"
            type="email"
            aria-label="Invite by registered email"
          />
          <button className="tool-button" type="submit">
            Invite
          </button>
        </form>
      )}

      <div className="initiative-table">
        <div className="table-head">
          <span></span>
          <span>Initiative</span>
          <span>Name</span>
          <span>Conditions</span>
          <span>HP</span>
          <span>AC</span>
          <span></span>
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={combatants.map((item) => item.id)} strategy={verticalListSortingStrategy}>
            <div className="table-body">
              {combatants.map((combatant) => (
                <CombatantRow
                  key={combatant.id}
                  combatant={combatant}
                  active={combatant.id === room.activeCombatantId}
                  canManage={isCreator}
                  canEdit={isCreator || combatant.ownerUid === user.uid}
                  canDrag={isCreator}
                  hideHp={!isCreator && room.hideHpFromInvitees}
                  hideAc={!isCreator && room.hideAcFromInvitees}
                  onUpdate={(patch) => updateCombatant(combatant.id, patch)}
                  onRemove={() => removeCombatant(combatant.id)}
                />
              ))}
              {combatants.length === 0 && <div className="empty-state">No combatants yet.</div>}
            </div>
          </SortableContext>
        </DndContext>
      </div>
    </section>
  );
}

function CombatantRow({
  combatant,
  active,
  canManage,
  canEdit,
  canDrag,
  hideHp,
  hideAc,
  onUpdate,
  onRemove,
}: {
  combatant: Combatant;
  active: boolean;
  canManage: boolean;
  canEdit: boolean;
  canDrag: boolean;
  hideHp: boolean;
  hideAc: boolean;
  onUpdate: (patch: Partial<Combatant>) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: combatant.id,
    disabled: !canDrag,
  });
  const down = combatant.hp <= 0;
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  function toggleCondition(condition: Condition) {
    const current = combatant.conditions || [];
    const next = current.includes(condition)
      ? current.filter((item) => item !== condition)
      : [...current, condition];
    onUpdate({ conditions: next });
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`combat-row${active ? " active" : ""}${down ? " down" : ""}${isDragging ? " dragging" : ""}`}
    >
      <button className="drag-handle" disabled={!canDrag} {...attributes} {...listeners} title="Drag row">
        <GripVertical aria-hidden="true" />
      </button>
      <input
        type="number"
        value={combatant.initiative}
        disabled={!canManage}
        onChange={(event) => onUpdate({ initiative: Number(event.target.value) })}
        aria-label={`${combatant.name} initiative`}
      />
      <input
        value={combatant.name}
        disabled={!canManage}
        onChange={(event) => onUpdate({ name: event.target.value })}
        aria-label="Combatant name"
      />
      <div className="conditions-cell">
        <details>
          <summary>{combatant.conditions?.length ? `${combatant.conditions.length} active` : "None"}</summary>
          <div className="condition-menu">
            {CONDITIONS.map((condition) => (
              <label key={condition}>
                <input
                  type="checkbox"
                  checked={combatant.conditions?.includes(condition) || false}
                  disabled={!canEdit}
                  onChange={() => toggleCondition(condition)}
                />
                {conditionLabel(condition)}
              </label>
            ))}
          </div>
        </details>
        <div className="condition-tags">
          {(combatant.conditions || []).map((condition) => (
            <span key={condition}>{conditionLabel(condition)}</span>
          ))}
        </div>
      </div>
      <div className="hp-cell">
        {hideHp ? (
          <strong>{hiddenHpStatus(combatant.hp, combatant.maxHp)}</strong>
        ) : (
          <>
            <input
              type="number"
              value={combatant.hp}
              disabled={!canEdit}
              onChange={(event) => onUpdate({ hp: Number(event.target.value) })}
              aria-label={`${combatant.name} current HP`}
            />
            <span>/</span>
            <input
              type="number"
              value={combatant.maxHp}
              disabled={!canManage}
              onChange={(event) => onUpdate({ maxHp: Number(event.target.value) })}
              aria-label={`${combatant.name} max HP`}
            />
          </>
        )}
      </div>
      <div className="ac-cell">
        {hideAc ? (
          <strong>Hidden</strong>
        ) : (
          <input
            type="number"
            value={combatant.ac}
            disabled={!canEdit}
            onChange={(event) => onUpdate({ ac: Number(event.target.value) })}
            aria-label={`${combatant.name} AC`}
          />
        )}
      </div>
      <button className="icon-button danger" disabled={!canManage} onClick={onRemove} title="Remove combatant">
        <Trash2 aria-hidden="true" />
      </button>
    </div>
  );
}
