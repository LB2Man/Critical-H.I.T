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
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDocs,
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
  ChevronLeft,
  GripVertical,
  HeartPulse,
  LogOut,
  Plus,
  RotateCcw,
  Shield,
  Skull,
  SortDesc,
  Sword,
  Trash2,
  Users,
} from "lucide-react";
import { auth, db, firebaseReady, googleProvider } from "../lib/firebase";
import {
  Combatant,
  Condition,
  ActiveCondition,
  HpVisibility,
  Room,
  CONDITIONS,
  conditionLabel,
  hiddenHpStatus,
  normalizeConditions,
} from "../lib/types";

type View = "rooms" | "room";
type RoomTab = "initiative" | "invite";

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [campaignOrder, setCampaignOrder] = useState<string[]>([]);
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
    if (!user || !firebaseReady) {
      setCampaignOrder([]);
      return;
    }

    return onSnapshot(doc(db, "users", user.uid), (snapshot) => {
      const order = snapshot.data()?.campaignOrder;
      setCampaignOrder(Array.isArray(order) ? order.filter((id): id is string => typeof id === "string") : []);
    });
  }, [user]);

  useEffect(() => {
    if (!user?.email || !firebaseReady) {
      setRooms([]);
      return;
    }

    const createdQuery = query(collection(db, "rooms"), where("creatorUid", "==", user.uid));
    const invitedQuery = query(collection(db, "rooms"), where("invitedEmails", "array-contains", user.email));
    const pendingQuery = query(collection(db, "rooms"), where("pendingInvitedEmails", "array-contains", user.email));

    const createdRooms = new Map<string, Room>();
    const invitedRooms = new Map<string, Room>();
    const pendingRooms = new Map<string, Room>();
    const publish = () => {
      setRooms(
        Array.from(
          new Map([
            ...pendingRooms,
            ...invitedRooms,
            ...createdRooms,
          ]).values(),
        ).sort((a, b) => a.name.localeCompare(b.name)),
      );
    };

    const unsubscribeCreated = onSnapshot(createdQuery, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === "removed") {
          createdRooms.delete(change.doc.id);
        } else {
          createdRooms.set(change.doc.id, { id: change.doc.id, ...change.doc.data() } as Room);
        }
      });
      publish();
    });

    const unsubscribeInvited = onSnapshot(invitedQuery, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === "removed") {
          invitedRooms.delete(change.doc.id);
        } else {
          invitedRooms.set(change.doc.id, { id: change.doc.id, ...change.doc.data() } as Room);
        }
      });
      publish();
    });

    const unsubscribePending = onSnapshot(pendingQuery, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === "removed") {
          pendingRooms.delete(change.doc.id);
        } else {
          pendingRooms.set(change.doc.id, { id: change.doc.id, ...change.doc.data() } as Room);
        }
      });
      publish();
    });

    return () => {
      unsubscribeCreated();
      unsubscribeInvited();
      unsubscribePending();
    };
  }, [user]);

  const activeRoom = useMemo(
    () => rooms.find((room) => room.id === activeRoomId) || null,
    [activeRoomId, rooms],
  );

  const orderedRooms = useMemo(() => {
    const orderIndex = new Map(campaignOrder.map((roomId, index) => [roomId, index]));
    return [...rooms].sort((a, b) => {
      const aIndex = orderIndex.get(a.id);
      const bIndex = orderIndex.get(b.id);

      if (aIndex !== undefined && bIndex !== undefined) return aIndex - bIndex;
      if (aIndex !== undefined) return -1;
      if (bIndex !== undefined) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [campaignOrder, rooms]);

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
      pendingInvitedEmails: [],
      round: 1,
      activeCombatantId: "",
      hideHpFromInvitees: false,
      hideAcFromInvitees: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const nextOrder = [roomRef.id, ...campaignOrder.filter((roomId) => roomId !== roomRef.id)];
    setCampaignOrder(nextOrder);
    await setDoc(
      doc(db, "users", user.uid),
      {
        campaignOrder: nextOrder,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    setActiveRoomId(roomRef.id);
    setView("room");
  }

  async function reorderCampaigns(nextOrder: string[]) {
    if (!user) return;
    setCampaignOrder(nextOrder);
    await setDoc(
      doc(db, "users", user.uid),
      {
        campaignOrder: nextOrder,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  }

  async function deleteCampaign(roomId: string) {
    if (!user) return;

    const combatants = await getDocs(collection(db, "rooms", roomId, "combatants"));
    const batch = writeBatch(db);
    combatants.docs.forEach((combatant) => batch.delete(combatant.ref));
    batch.delete(doc(db, "rooms", roomId));
    await batch.commit();

    const nextOrder = campaignOrder.filter((id) => id !== roomId);
    setCampaignOrder(nextOrder);
    await setDoc(
      doc(db, "users", user.uid),
      {
        campaignOrder: nextOrder,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    if (activeRoomId === roomId) {
      setActiveRoomId(null);
      setView("rooms");
    }
  }

  async function acceptCampaignInvite(roomId: string) {
    if (!user?.email) return;
    await updateDoc(doc(db, "rooms", roomId), {
      invitedEmails: arrayUnion(user.email),
      pendingInvitedEmails: arrayRemove(user.email),
      updatedAt: serverTimestamp(),
    });
  }

  async function declineCampaignInvite(roomId: string) {
    if (!user?.email) return;
    await updateDoc(doc(db, "rooms", roomId), {
      pendingInvitedEmails: arrayRemove(user.email),
      updatedAt: serverTimestamp(),
    });
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
          rooms={orderedRooms}
          user={user}
          onCreateRoom={handleCreateRoom}
          onOpenRoom={(roomId) => {
            setActiveRoomId(roomId);
            setView("room");
          }}
          onAcceptInvite={acceptCampaignInvite}
          onDeclineInvite={declineCampaignInvite}
          onReorderCampaigns={reorderCampaigns}
          onDeleteCampaign={deleteCampaign}
        />
      ) : activeRoom ? (
        <RoomView room={activeRoom} user={user} onBack={() => setView("rooms")} />
      ) : (
        <RoomsView
          rooms={orderedRooms}
          user={user}
          onCreateRoom={handleCreateRoom}
          onOpenRoom={(roomId) => {
            setActiveRoomId(roomId);
            setView("room");
          }}
          onAcceptInvite={acceptCampaignInvite}
          onDeclineInvite={declineCampaignInvite}
          onReorderCampaigns={reorderCampaigns}
          onDeleteCampaign={deleteCampaign}
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
      <p>Sign in with Google to enter your campaigns.</p>
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
  onAcceptInvite,
  onDeclineInvite,
  onReorderCampaigns,
  onDeleteCampaign,
}: {
  rooms: Room[];
  user: User;
  onCreateRoom: (formData: FormData) => void;
  onOpenRoom: (roomId: string) => void;
  onAcceptInvite: (roomId: string) => void;
  onDeclineInvite: (roomId: string) => void;
  onReorderCampaigns: (roomIds: string[]) => void;
  onDeleteCampaign: (roomId: string) => void;
}) {
  const [campaignToDelete, setCampaignToDelete] = useState<Room | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleCampaignDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = rooms.findIndex((room) => room.id === active.id);
    const newIndex = rooms.findIndex((room) => room.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    onReorderCampaigns(arrayMove(rooms, oldIndex, newIndex).map((room) => room.id));
  }

  return (
    <section className="room-list-page">
      <div className="page-heading">
        <h1>Choose a Campaign</h1>
      </div>

      <form className="create-room" action={onCreateRoom}>
        <input name="roomName" placeholder="Campaign name" aria-label="Campaign name" />
        <button className="primary-action" type="submit">
          <Plus aria-hidden="true" />
          Create Campaign
        </button>
      </form>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleCampaignDragEnd}>
        <SortableContext items={rooms.map((room) => room.id)} strategy={verticalListSortingStrategy}>
          <div className="rooms-grid">
            {rooms.map((room) => (
              <CampaignCard
                key={room.id}
                room={room}
                user={user}
                onOpenRoom={onOpenRoom}
                onAcceptInvite={onAcceptInvite}
                onDeclineInvite={onDeclineInvite}
                onRequestDelete={setCampaignToDelete}
              />
            ))}
            {rooms.length === 0 && (
              <div className="empty-state">Create your first campaign to start tracking combat.</div>
            )}
          </div>
        </SortableContext>
      </DndContext>

      {campaignToDelete && (
        <div className="modal-backdrop" role="presentation">
          <div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delete-campaign-title">
            <h2 id="delete-campaign-title">Delete campaign?</h2>
            <p>This will remove {campaignToDelete.name} and its combatants.</p>
            <div className="confirm-actions">
              <button className="subtle-button" onClick={() => setCampaignToDelete(null)}>
                Cancel
              </button>
              <button
                className="tool-button danger"
                onClick={() => {
                  onDeleteCampaign(campaignToDelete.id);
                  setCampaignToDelete(null);
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function CampaignCard({
  room,
  user,
  onOpenRoom,
  onAcceptInvite,
  onDeclineInvite,
  onRequestDelete,
}: {
  room: Room;
  user: User;
  onOpenRoom: (roomId: string) => void;
  onAcceptInvite: (roomId: string) => void;
  onDeclineInvite: (roomId: string) => void;
  onRequestDelete: (room: Room) => void;
}) {
  const isPending = Boolean(user.email && room.pendingInvitedEmails?.includes(user.email));
  const isCreator = room.creatorUid === user.uid;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: room.id,
  });

  return (
    <div
      ref={setNodeRef}
      className={`room-card${isDragging ? " dragging" : ""}`}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
    >
      <div className="campaign-card-top">
        <button className="drag-handle campaign-drag" {...attributes} {...listeners} title="Drag campaign">
          <GripVertical aria-hidden="true" />
        </button>
        <Users aria-hidden="true" />
        {isCreator && (
          <button className="icon-button danger" title="Delete campaign" onClick={() => onRequestDelete(room)}>
            <Trash2 aria-hidden="true" />
          </button>
        )}
      </div>
      <span>{room.name}</span>
      <small>{isCreator ? "Creator" : isPending ? "Pending invite" : "Invited"}</small>
      {isPending ? (
        <div className="campaign-invite-actions">
          <button className="tool-button" onClick={() => onAcceptInvite(room.id)}>
            Accept
          </button>
          <button className="tool-button danger" onClick={() => onDeclineInvite(room.id)}>
            Decline
          </button>
        </div>
      ) : (
        <button className="tool-button" onClick={() => onOpenRoom(room.id)}>
          Open
        </button>
      )}
    </div>
  );
}

function RoomView({ room, user, onBack }: { room: Room; user: User; onBack: () => void }) {
  const isCreator = room.creatorUid === user.uid;
  const [combatants, setCombatants] = useState<Combatant[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [activeTab, setActiveTab] = useState<RoomTab>("initiative");

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
    if (room.invitedEmails.includes(email) || (room.pendingInvitedEmails ?? []).includes(email)) {
      setInviteEmail("");
      return;
    }

    await updateDoc(doc(db, "rooms", room.id), {
      pendingInvitedEmails: arrayUnion(email),
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
      exhaustionLevel: 0,
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
    const combatant = combatants.find((item) => item.id === id);
    if (!isCreator && combatant?.ownerUid !== user.uid) return;
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

    const nextCombatant = isNewRound ? combatants[0] : combatants[nextIndex];
    const nextRound = isNewRound ? room.round + 1 : room.round;
    const batch = writeBatch(db);

    batch.update(doc(db, "rooms", room.id), {
      activeCombatantId: isNewRound ? combatants[0].id : combatants[nextIndex].id,
      round: nextRound,
      updatedAt: serverTimestamp(),
    });

    const remainingConditions = normalizeConditions(nextCombatant.conditions).filter(
      (condition) => !condition.expiresOnRound || condition.expiresOnRound > nextRound,
    );

    if (remainingConditions.length !== normalizeConditions(nextCombatant.conditions).length) {
      batch.update(doc(db, "rooms", room.id, "combatants", nextCombatant.id), {
        conditions: remainingConditions,
        updatedAt: serverTimestamp(),
      });
    }

    await batch.commit();
  }

  async function handleBack() {
    if (!isCreator || combatants.length === 0) return;
    const currentIndex = Math.max(
      combatants.findIndex((combatant) => combatant.id === room.activeCombatantId),
      0,
    );
    const previousIndex = currentIndex - 1;
    const isPreviousRound = previousIndex < 0;
    if (isPreviousRound && room.round <= 1) return;

    const previousCombatant = isPreviousRound ? combatants[combatants.length - 1] : combatants[previousIndex];

    await updateDoc(doc(db, "rooms", room.id), {
      activeCombatantId: previousCombatant.id,
      round: isPreviousRound ? Math.max(1, room.round - 1) : room.round,
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

  async function removeInvite(email: string) {
    if (!isCreator) return;
    await updateDoc(doc(db, "rooms", room.id), {
      invitedEmails: arrayRemove(email),
      pendingInvitedEmails: arrayRemove(email),
      updatedAt: serverTimestamp(),
    });
  }

  return (
    <section className="room-page">
      <div className="room-header">
        <button className="subtle-button" onClick={onBack}>
          Campaigns
        </button>
        <div>
          <p className="eyebrow">Initiative</p>
          <h1>{room.name}</h1>
        </div>
        <div className="round-display">Round {room.round}</div>
      </div>

      <nav className="tabs" aria-label="Room tools">
        <button
          className={`tab${activeTab === "initiative" ? " active" : ""}`}
          onClick={() => setActiveTab("initiative")}
        >
          Initiative
        </button>
        <button
          className={`tab${activeTab === "invite" ? " active" : ""}`}
          onClick={() => setActiveTab("invite")}
          disabled={!isCreator}
        >
          Invite Player
        </button>
      </nav>

      {activeTab === "invite" && isCreator ? (
        <section className="invite-panel">
          <h2>Invite Player</h2>
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
          <div className="invite-list">
            {Array.from(new Set([...room.invitedEmails, ...(room.pendingInvitedEmails ?? [])])).length ? (
              Array.from(new Set([...room.invitedEmails, ...(room.pendingInvitedEmails ?? [])])).map((email) => (
                <div className="invite-row" key={email}>
                  <span>
                    {email}
                    {(room.pendingInvitedEmails ?? []).includes(email) ? " (pending)" : ""}
                  </span>
                  <button className="tool-button danger" onClick={() => removeInvite(email)}>
                    Remove
                  </button>
                </div>
              ))
            ) : (
              <div className="empty-state">No invited players yet.</div>
            )}
          </div>
        </section>
      ) : (
        <div className="initiative-tab">
          <div className="tracker-toolbar">
            <button className="primary-action" onClick={handleBack} disabled={!isCreator}>
              <ChevronLeft aria-hidden="true" />
              Back
            </button>
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
            {isCreator && (
              <>
                <button className="toggle-button" onClick={() => toggleVisibility("hideHpFromInvitees")}>
                  HP: {room.hideHpFromInvitees ? "Status" : "Visible"}
                </button>
                <button className="toggle-button" onClick={() => toggleVisibility("hideAcFromInvitees")}>
                  AC: {room.hideAcFromInvitees ? "Hidden" : "Visible"}
                </button>
                <button className="tool-button" onClick={resetRound} disabled={!isCreator}>
                  <RotateCcw aria-hidden="true" />
                  Reset Round
                </button>
              </>
            )}
          </div>

          <div className="initiative-table">
            <div className="combat-heading">
              <span>Combat</span>
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
                      round={room.round}
                      active={combatant.id === room.activeCombatantId}
                      canManage={isCreator || combatant.ownerUid === user.uid}
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
        </div>
      )}
    </section>
  );
}

function CombatantRow({
  combatant,
  round,
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
  round: number;
  active: boolean;
  canManage: boolean;
  canEdit: boolean;
  canDrag: boolean;
  hideHp: boolean;
  hideAc: boolean;
  onUpdate: (patch: Partial<Combatant>) => void;
  onRemove: () => void;
}) {
  const [addingCondition, setAddingCondition] = useState(false);
  const [conditionName, setConditionName] = useState<Condition>("blinded");
  const [conditionRounds, setConditionRounds] = useState("");
  const [hpActionAmount, setHpActionAmount] = useState("");
  const [concentrationSaveDc, setConcentrationSaveDc] = useState<number | null>(null);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: combatant.id,
    disabled: !canDrag,
  });
  const down = combatant.hp <= 0;
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const conditions = normalizeConditions(combatant.conditions);
  const exhaustionLevel = combatant.exhaustionLevel ?? 0;

  function addCondition(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit) return;

    const rounds = Number(conditionRounds);
    const hasRounds = Number.isFinite(rounds) && rounds > 0;
    const nextCondition: ActiveCondition = {
      id: `${conditionName}-${Date.now()}`,
      name: conditionName,
    };

    if (hasRounds) {
      nextCondition.rounds = rounds;
      nextCondition.expiresOnRound = round + rounds;
    }

    onUpdate({ conditions: [...conditions, nextCondition] });
    setConditionRounds("");
    setAddingCondition(false);
  }

  function removeCondition(id: string) {
    if (!canEdit) return;
    onUpdate({ conditions: conditions.filter((condition) => condition.id !== id) });
  }

  function conditionRoundsLeft(condition: ActiveCondition) {
    if (!condition.expiresOnRound) return "";
    const remaining = Math.max(0, condition.expiresOnRound - round);
    return `${remaining} ${remaining === 1 ? "round" : "rounds"} left`;
  }

  function applyHpDelta(direction: "damage" | "heal") {
    if (!canEdit) return;

    const amount = Number(hpActionAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;

    const nextHp =
      direction === "damage"
        ? Math.max(0, combatant.hp - amount)
        : Math.min(combatant.maxHp, combatant.hp + amount);

    onUpdate({ hp: nextHp });
    setHpActionAmount("");

    if (direction === "damage" && conditions.some((condition) => condition.name === "concentration")) {
      setConcentrationSaveDc(Math.max(10, Math.floor(amount / 2)));
    }
  }

  function resolveConcentrationSave(failed: boolean) {
    if (failed) {
      onUpdate({
        conditions: conditions.filter((condition) => condition.name !== "concentration"),
      });
    }

    setConcentrationSaveDc(null);
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
      <label className="field-stack initiative-field">
        <span>Init</span>
        <input
          type="number"
          value={combatant.initiative}
          disabled={!canManage}
          onChange={(event) => onUpdate({ initiative: Number(event.target.value) })}
          aria-label={`${combatant.name} initiative`}
        />
      </label>
      <div className="combatant-main">
        <input
          className="name-input"
          value={combatant.name}
          placeholder="Name"
          disabled={!canManage}
          onChange={(event) => onUpdate({ name: event.target.value })}
          aria-label="Combatant name"
        />
        <div className="condition-tags">
          {conditions.map((condition) => (
            <button
              className="condition-chip"
              key={condition.id}
              disabled={!canEdit}
              onClick={() => removeCondition(condition.id)}
              title="Remove condition"
            >
              {conditionLabel(condition.name)}
              {condition.rounds ? ` (${conditionRoundsLeft(condition)})` : ""}
              <span aria-hidden="true">x</span>
            </button>
          ))}
          {conditions.length === 0 && <span className="no-conditions">No conditions</span>}
        </div>
        <div className="add-condition-wrap">
          <button className="add-condition" disabled={!canEdit} onClick={() => setAddingCondition(true)}>
            + Add Condition
          </button>
          {addingCondition && (
            <form className="condition-menu" onSubmit={addCondition}>
              <select
                value={conditionName}
                onChange={(event) => setConditionName(event.target.value as Condition)}
                aria-label="Condition"
              >
                {CONDITIONS.map((condition) => (
                  <option key={condition} value={condition}>
                    {conditionLabel(condition)}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min="1"
                value={conditionRounds}
                onChange={(event) => setConditionRounds(event.target.value)}
                placeholder="Rounds"
                aria-label="Round limit"
              />
              <button className="tool-button" type="submit">
                Add
              </button>
              <button className="subtle-button" type="button" onClick={() => setAddingCondition(false)}>
                Cancel
              </button>
            </form>
          )}
        </div>
      </div>
      <div className="stat-fields">
        <label className="field-stack hp-field">
          <div className="hp-control">
            <div className="hp-cell">
              <input
                className="hp-action-amount"
                type="number"
                min="1"
                value={hpActionAmount}
                disabled={!canEdit}
                onChange={(event) => setHpActionAmount(event.target.value)}
                placeholder=""
                aria-label="Damage or healing amount"
              />
              <div className="hp-action-buttons">
                <button
                  className="mini-icon danger"
                  type="button"
                  disabled={!canEdit}
                  onClick={() => applyHpDelta("damage")}
                  title="Damage"
                >
                  <Sword aria-hidden="true" />
                </button>
                <button
                  className="mini-icon heal"
                  type="button"
                  disabled={!canEdit}
                  onClick={() => applyHpDelta("heal")}
                  title="Heal"
                >
                  <HeartPulse aria-hidden="true" />
                </button>
              </div>
              {hideHp ? (
                <strong>{hiddenHpStatus(combatant.hp, combatant.maxHp)}</strong>
              ) : (
                <>
                  <label className="inline-stat-field">
                    <span>HP</span>
                    <input
                      type="number"
                      value={combatant.hp}
                      disabled={!canEdit}
                      onChange={(event) => onUpdate({ hp: Number(event.target.value) })}
                      aria-label={`${combatant.name} current HP`}
                    />
                  </label>
                  <span>/</span>
                  <label className="inline-stat-field">
                    <span>Max HP</span>
                    <input
                      type="number"
                      value={combatant.maxHp}
                      disabled={!canManage}
                      onChange={(event) => onUpdate({ maxHp: Number(event.target.value) })}
                      aria-label={`${combatant.name} max HP`}
                    />
                  </label>
                </>
              )}
            </div>
          </div>
        </label>
        <label className="field-stack">
          <span>AC</span>
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
        </label>
        <label className="field-stack">
          <span>Exh</span>
          <select
            value={exhaustionLevel}
            disabled={!canEdit}
            onChange={(event) => onUpdate({ exhaustionLevel: Number(event.target.value) })}
            aria-label={`${combatant.name} exhaustion level`}
          >
            {[0, 1, 2, 3, 4, 5, 6].map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </label>
      </div>
      <button className="icon-button danger" disabled={!canManage} onClick={onRemove} title="Remove combatant">
        <Trash2 aria-hidden="true" />
      </button>
      {concentrationSaveDc !== null && (
        <div className="modal-backdrop locked-modal" role="presentation">
          <div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="concentration-save-title">
            <h2 id="concentration-save-title">Concentration Save</h2>
            <p>
              DC <strong>{concentrationSaveDc}</strong>
            </p>
            <div className="confirm-actions">
              <button className="tool-button" onClick={() => resolveConcentrationSave(false)}>
                Success
              </button>
              <button className="tool-button danger" onClick={() => resolveConcentrationSave(true)}>
                Failed
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
