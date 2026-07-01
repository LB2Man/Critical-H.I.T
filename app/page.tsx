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
  rectSortingStrategy,
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
  deleteField,
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
} from "lucide-react";
import { auth, db, firebaseReady, googleProvider } from "../lib/firebase";
import {
  Combatant,
  Condition,
  ActiveCondition,
  HpVisibility,
  Room,
  StatBlock,
  CONDITIONS,
  activeConditionLabel,
  conditionLabel,
  hiddenHpStatus,
  normalizeConditions,
} from "../lib/types";

type View = "rooms" | "room";
type RoomTab = "initiative" | "invite" | "statBlocks";

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
    const statBlocks = await getDocs(collection(db, "rooms", roomId, "statBlocks"));
    const batch = writeBatch(db);
    combatants.docs.forEach((combatant) => batch.delete(combatant.ref));
    statBlocks.docs.forEach((statBlock) => batch.delete(statBlock.ref));
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

  async function leaveCampaign(roomId: string) {
    if (!user?.email) return;
    await updateDoc(doc(db, "rooms", roomId), {
      invitedEmails: arrayRemove(user.email),
      updatedAt: serverTimestamp(),
    });

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
          onLeaveCampaign={leaveCampaign}
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
          onLeaveCampaign={leaveCampaign}
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
  onLeaveCampaign,
  onReorderCampaigns,
  onDeleteCampaign,
}: {
  rooms: Room[];
  user: User;
  onCreateRoom: (formData: FormData) => void;
  onOpenRoom: (roomId: string) => void;
  onAcceptInvite: (roomId: string) => void;
  onDeclineInvite: (roomId: string) => void;
  onLeaveCampaign: (roomId: string) => void;
  onReorderCampaigns: (roomIds: string[]) => void;
  onDeleteCampaign: (roomId: string) => void;
}) {
  const [campaignAction, setCampaignAction] = useState<{
    room: Room;
    type: "delete" | "leave";
  } | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
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
        <SortableContext items={rooms.map((room) => room.id)} strategy={rectSortingStrategy}>
          <div className="rooms-grid">
            {rooms.map((room) => (
              <CampaignCard
                key={room.id}
                room={room}
                user={user}
                onOpenRoom={onOpenRoom}
                onAcceptInvite={onAcceptInvite}
                onDeclineInvite={onDeclineInvite}
                onRequestAction={setCampaignAction}
              />
            ))}
            {rooms.length === 0 && (
              <div className="empty-state">Create your first campaign to start tracking combat.</div>
            )}
          </div>
        </SortableContext>
      </DndContext>

      {campaignAction && (
        <div className="modal-backdrop" role="presentation">
          <div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delete-campaign-title">
            <h2 id="delete-campaign-title">
              {campaignAction.type === "delete" ? "Delete campaign?" : "Leave campaign?"}
            </h2>
            <p>
              {campaignAction.type === "delete"
                ? `This will remove ${campaignAction.room.name} and its combatants.`
                : `This will remove ${campaignAction.room.name} from your campaign list.`}
            </p>
            <div className="confirm-actions">
              <button className="subtle-button" onClick={() => setCampaignAction(null)}>
                Cancel
              </button>
              <button
                className="tool-button danger"
                onClick={() => {
                  if (campaignAction.type === "delete") {
                    onDeleteCampaign(campaignAction.room.id);
                  } else {
                    onLeaveCampaign(campaignAction.room.id);
                  }
                  setCampaignAction(null);
                }}
              >
                {campaignAction.type === "delete" ? "Delete" : "Leave"}
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
  onRequestAction,
}: {
  room: Room;
  user: User;
  onOpenRoom: (roomId: string) => void;
  onAcceptInvite: (roomId: string) => void;
  onDeclineInvite: (roomId: string) => void;
  onRequestAction: (action: { room: Room; type: "delete" | "leave" }) => void;
}) {
  const isPending = Boolean(user.email && room.pendingInvitedEmails?.includes(user.email));
  const isCreator = room.creatorUid === user.uid;
  const isAcceptedInvitee = Boolean(user.email && room.invitedEmails.includes(user.email) && !isCreator);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: room.id,
  });
  const canOpen = !isPending;
  const handleTrashClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (isCreator) {
      onRequestAction({ room, type: "delete" });
    } else if (isAcceptedInvitee) {
      onRequestAction({ room, type: "leave" });
    }
  };
  const stopCardGesture = (event: React.SyntheticEvent) => {
    event.stopPropagation();
  };

  return (
    <div
      ref={setNodeRef}
      className={`room-card${isDragging ? " dragging" : ""}${canOpen ? " clickable" : ""}`}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      onClick={() => {
        if (canOpen) onOpenRoom(room.id);
      }}
      onKeyDown={(event) => {
        if (canOpen && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onOpenRoom(room.id);
        }
      }}
      {...attributes}
      {...listeners}
    >
      <div className="campaign-card-top">
        <D20Icon />
        {(isCreator || isAcceptedInvitee) && (
          <button
            className="icon-button danger"
            title={isCreator ? "Delete campaign" : "Leave campaign"}
            onPointerDown={stopCardGesture}
            onKeyDown={stopCardGesture}
            onClick={handleTrashClick}
          >
            <Trash2 aria-hidden="true" />
          </button>
        )}
      </div>
      <span>{room.name}</span>
      <small>{isCreator ? "Creator" : isPending ? "Pending invite" : "Invited"}</small>
      {isPending ? (
        <div className="campaign-invite-actions">
          <button
            className="tool-button"
            onPointerDown={stopCardGesture}
            onKeyDown={stopCardGesture}
            onClick={(event) => {
              event.stopPropagation();
              onAcceptInvite(room.id);
            }}
          >
            Accept
          </button>
          <button
            className="tool-button danger"
            onPointerDown={stopCardGesture}
            onKeyDown={stopCardGesture}
            onClick={(event) => {
              event.stopPropagation();
              onDeclineInvite(room.id);
            }}
          >
            Decline
          </button>
        </div>
      ) : null}
    </div>
  );
}

function D20Icon() {
  return (
    <svg className="campaign-d20" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <path className="d20-fill" d="M32 3 60 20 60 47 32 61 4 47 4 20Z" />
      <path d="M32 3 60 20 60 47 32 61 4 47 4 20Z" />
      <path d="M32 3v12" />
      <path d="M4 20 32 15 60 20" />
      <path d="M32 15 15 45" />
      <path d="M32 15 49 45" />
      <path d="M15 45h34" />
      <path d="M4 20 15 45 4 47" />
      <path d="M60 20 49 45 60 47" />
      <path d="M15 45 32 61 49 45" />
      <path d="M4 47 32 61 60 47" />
      <text className="d20-number d20-center" x="32" y="37.5" textAnchor="middle" textLength="17" lengthAdjust="spacingAndGlyphs">
        20
      </text>
    </svg>
  );
}

function RoomView({ room, user, onBack }: { room: Room; user: User; onBack: () => void }) {
  const isCreator = room.creatorUid === user.uid;
  const [combatants, setCombatants] = useState<Combatant[]>([]);
  const [statBlocks, setStatBlocks] = useState<StatBlock[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [activeTab, setActiveTab] = useState<RoomTab>("initiative");
  const [activeStatBlockId, setActiveStatBlockId] = useState<string | null>(null);
  const [deleteStatBlockId, setDeleteStatBlockId] = useState<string | null>(null);

  useEffect(() => {
    const combatantsQuery = query(
      collection(db, "rooms", room.id, "combatants"),
      orderBy("order", "asc"),
    );

    return onSnapshot(combatantsQuery, (snapshot) => {
      setCombatants(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Combatant));
    });
  }, [room.id]);

  useEffect(() => {
    if (!isCreator) {
      setStatBlocks([]);
      return;
    }

    const statBlocksQuery = query(collection(db, "rooms", room.id, "statBlocks"));

    return onSnapshot(statBlocksQuery, (snapshot) => {
      setStatBlocks(
        snapshot.docs
          .map((item) => ({ id: item.id, ...item.data() }) as StatBlock)
          .sort((a, b) => {
            const aOrder = typeof a.order === "number" ? a.order : null;
            const bOrder = typeof b.order === "number" ? b.order : null;
            if (aOrder !== null && bOrder !== null) return aOrder - bOrder;
            if (aOrder !== null) return -1;
            if (bOrder !== null) return 1;
            return a.title.localeCompare(b.title);
          }),
      );
    });
  }, [isCreator, room.id]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
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
      tempHp: 0,
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

  async function addStatBlock() {
    if (!isCreator) return;
    const existingDraft = statBlocks.find((statBlock) => !statBlock.title.trim());
    if (existingDraft) {
      setActiveStatBlockId(existingDraft.id);
      return;
    }

    const order = statBlocks.length ? Math.max(...statBlocks.map((item) => item.order ?? 0)) + 1 : 0;
    const statBlockRef = await addDoc(collection(db, "rooms", room.id, "statBlocks"), {
      title: "",
      ac: 10,
      hp: 10,
      body: "AC 10\nHP 10\n\n**Abilities**\nAdd abilities here.",
      order,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    setActiveStatBlockId(statBlockRef.id);
  }

  async function updateStatBlock(id: string, patch: Partial<StatBlock>) {
    if (!isCreator) return;
    await updateDoc(doc(db, "rooms", room.id, "statBlocks", id), {
      ...patch,
      updatedAt: serverTimestamp(),
    });
  }

  async function removeStatBlock(id: string) {
    if (!isCreator) return;
    await deleteDoc(doc(db, "rooms", room.id, "statBlocks", id));
    if (activeStatBlockId === id) setActiveStatBlockId(null);
    setDeleteStatBlockId(null);
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

  async function handleStatBlockDragEnd(event: DragEndEvent) {
    if (!isCreator) return;

    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = statBlocks.findIndex((statBlock) => statBlock.id === active.id);
    const newIndex = statBlocks.findIndex((statBlock) => statBlock.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const reordered = arrayMove(statBlocks, oldIndex, newIndex);
    const batch = writeBatch(db);

    reordered.forEach((statBlock, index) => {
      batch.update(doc(db, "rooms", room.id, "statBlocks", statBlock.id), {
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
          <h1>{room.name}</h1>
        </div>
        <div className="round-display">Round {room.round}</div>
      </div>

      <nav className="tabs" aria-label="Room tools">
        <button
          className={`tab${activeTab === "invite" ? " active" : ""}`}
          onClick={() => setActiveTab("invite")}
          disabled={!isCreator}
        >
          Invite Player
        </button>
        <button
          className={`tab${activeTab === "initiative" ? " active" : ""}`}
          onClick={() => setActiveTab("initiative")}
        >
          Initiative
        </button>
        {isCreator && (
          <button
            className={`tab${activeTab === "statBlocks" ? " active" : ""}`}
            onClick={() => setActiveTab("statBlocks")}
          >
            Stat Blocks
          </button>
        )}
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
      ) : activeTab === "statBlocks" && isCreator ? (
        <StatBlocksTab
          statBlocks={statBlocks}
          activeStatBlockId={activeStatBlockId}
          deleteStatBlockId={deleteStatBlockId}
          sensors={sensors}
          onAdd={addStatBlock}
          onOpen={setActiveStatBlockId}
          onClose={() => setActiveStatBlockId(null)}
          onUpdate={updateStatBlock}
          onRequestDelete={setDeleteStatBlockId}
          onCancelDelete={() => setDeleteStatBlockId(null)}
          onDelete={removeStatBlock}
          onDragEnd={handleStatBlockDragEnd}
        />
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
                <button className="tool-button reset-round-button" onClick={resetRound} disabled={!isCreator}>
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
                      currentUserId={user.uid}
                      statBlocks={isCreator ? statBlocks.filter((statBlock) => statBlock.title.trim()) : []}
                      hideHp={!isCreator && combatant.ownerUid !== user.uid && room.hideHpFromInvitees}
                      hideAc={!isCreator && combatant.ownerUid !== user.uid && room.hideAcFromInvitees}
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

function StatBlocksTab({
  statBlocks,
  activeStatBlockId,
  deleteStatBlockId,
  sensors,
  onAdd,
  onOpen,
  onClose,
  onUpdate,
  onRequestDelete,
  onCancelDelete,
  onDelete,
  onDragEnd,
}: {
  statBlocks: StatBlock[];
  activeStatBlockId: string | null;
  deleteStatBlockId: string | null;
  sensors: ReturnType<typeof useSensors>;
  onAdd: () => void;
  onOpen: (id: string) => void;
  onClose: () => void;
  onUpdate: (id: string, patch: Partial<StatBlock>) => void;
  onRequestDelete: (id: string) => void;
  onCancelDelete: () => void;
  onDelete: (id: string) => void;
  onDragEnd: (event: DragEndEvent) => void;
}) {
  const activeStatBlock = statBlocks.find((statBlock) => statBlock.id === activeStatBlockId) || null;
  const deleteStatBlock = statBlocks.find((statBlock) => statBlock.id === deleteStatBlockId) || null;

  return (
    <section className="stat-blocks-tab">
      <div className="stat-block-toolbar">
        <button className="tool-button" onClick={onAdd}>
          <Plus aria-hidden="true" />
          Add
        </button>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={statBlocks.map((statBlock) => statBlock.id)} strategy={rectSortingStrategy}>
          <div className="stat-block-grid">
            {statBlocks.map((statBlock) => (
              <StatBlockCard
                key={statBlock.id}
                statBlock={statBlock}
                onOpen={onOpen}
                onRequestDelete={onRequestDelete}
              />
            ))}
            {statBlocks.length === 0 && <div className="empty-state">No stat blocks yet.</div>}
          </div>
        </SortableContext>
      </DndContext>

      {activeStatBlock && (
        <StatBlockModal
          statBlock={activeStatBlock}
          statBlocks={statBlocks}
          onClose={onClose}
          onUpdate={onUpdate}
        />
      )}

      {deleteStatBlock && (
        <div className="modal-backdrop" role="presentation">
          <div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delete-stat-block-title">
            <h2 id="delete-stat-block-title">Delete stat block?</h2>
            <p>This will remove {deleteStatBlock.title || "this stat block"}.</p>
            <div className="confirm-actions">
              <button className="subtle-button" onClick={onCancelDelete}>
                Cancel
              </button>
              <button className="tool-button danger" onClick={() => onDelete(deleteStatBlock.id)}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function StatBlockCard({
  statBlock,
  onOpen,
  onRequestDelete,
}: {
  statBlock: StatBlock;
  onOpen: (id: string) => void;
  onRequestDelete: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: statBlock.id,
  });

  const stopCardGesture = (event: React.SyntheticEvent) => {
    event.stopPropagation();
  };

  return (
    <div
      ref={setNodeRef}
      className={`stat-block-card${isDragging ? " dragging" : ""}`}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      onClick={() => onOpen(statBlock.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(statBlock.id);
        }
      }}
      {...attributes}
      {...listeners}
    >
      <div className="stat-block-card-top">
        <MonsterIcon />
        <button
          className="icon-button danger"
          title="Delete stat block"
          onPointerDown={stopCardGesture}
          onKeyDown={stopCardGesture}
          onClick={(event) => {
            event.stopPropagation();
            onRequestDelete(statBlock.id);
          }}
        >
          <Trash2 aria-hidden="true" />
        </button>
      </div>
      <span>{statBlock.title || "Name"}</span>
    </div>
  );
}

function MonsterIcon() {
  return (
    <svg className="monster-icon" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <path d="M12 29 21 13l11 9 11-9 9 16-5 22H17Z" />
      <path d="M20 31h9" />
      <path d="M35 31h9" />
      <path d="M24 44h16" />
      <path d="M17 51 8 58" />
      <path d="M47 51l9 7" />
    </svg>
  );
}

function normalizeStatBlockTitle(title: string) {
  return title.trim().replace(/\s+/g, " ").toLowerCase();
}

function StatBlockModal({
  statBlock,
  statBlocks,
  onClose,
  onUpdate,
}: {
  statBlock: StatBlock;
  statBlocks: StatBlock[];
  onClose: () => void;
  onUpdate: (id: string, patch: Partial<StatBlock>) => void;
}) {
  const [draftTitle, setDraftTitle] = useState(statBlock.title);
  const [draftAc, setDraftAc] = useState(statBlock.ac ?? 10);
  const [draftHp, setDraftHp] = useState(statBlock.hp ?? 10);
  const [draftBody, setDraftBody] = useState(statBlock.body);
  const [editing, setEditing] = useState(!statBlock.title && !statBlock.body);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [titleError, setTitleError] = useState("");

  useEffect(() => {
    setDraftTitle(statBlock.title);
    setDraftAc(statBlock.ac ?? 10);
    setDraftHp(statBlock.hp ?? 10);
    setDraftBody(statBlock.body);
    setEditing(!statBlock.title && !statBlock.body);
    setConfirmDiscard(false);
    setTitleError("");
  }, [statBlock.id, statBlock.title, statBlock.body]);

  const hasUnsavedChanges =
    draftTitle !== statBlock.title ||
    draftAc !== (statBlock.ac ?? 10) ||
    draftHp !== (statBlock.hp ?? 10) ||
    draftBody !== statBlock.body;

  function saveStatBlock() {
    const normalizedTitle = normalizeStatBlockTitle(draftTitle);
    const duplicate = statBlocks.some(
      (item) => item.id !== statBlock.id && normalizeStatBlockTitle(item.title) === normalizedTitle,
    );

    if (!normalizedTitle) {
      setTitleError("Please give this stat block a name.");
      return;
    }

    if (duplicate) {
      setTitleError("A stat block with this name already exists.");
      return;
    }

    onUpdate(statBlock.id, {
      title: draftTitle.trim(),
      ac: draftAc,
      hp: draftHp,
      body: draftBody,
    });
    setEditing(false);
    setConfirmDiscard(false);
    setTitleError("");
  }

  function requestClose() {
    if (editing && hasUnsavedChanges) {
      setConfirmDiscard(true);
      return;
    }

    onClose();
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={requestClose}>
      <div
        className="stat-block-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="stat-block-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="stat-block-modal-header">
          <div className="stat-block-title-area">
            {editing ? (
              <>
                <input
                  id="stat-block-title"
                  value={draftTitle}
                  onChange={(event) => {
                    setDraftTitle(event.target.value);
                    setTitleError("");
                  }}
                  placeholder="Name"
                  aria-label="Stat block title"
                />
                <div className="stat-block-core-fields">
                  <label className="field-stack">
                    <span>AC</span>
                    <input
                      type="number"
                      value={draftAc}
                      onChange={(event) => setDraftAc(Number(event.target.value))}
                      aria-label="Stat block AC"
                    />
                  </label>
                  <label className="field-stack">
                    <span>HP</span>
                    <input
                      type="number"
                      value={draftHp}
                      onChange={(event) => setDraftHp(Number(event.target.value))}
                      aria-label="Stat block HP"
                    />
                  </label>
                </div>
              </>
            ) : (
              <>
                <h2 id="stat-block-title">{draftTitle || "Name"}</h2>
                <div className="stat-block-core-summary">
                  <span>AC {draftAc}</span>
                  <span>HP {draftHp}</span>
                </div>
              </>
            )}
          </div>
          <div className="stat-block-modal-actions">
            {editing ? (
              <button className="tool-button" onClick={saveStatBlock}>
                Save
              </button>
            ) : (
              <button className="tool-button" onClick={() => setEditing(true)}>
                Edit
              </button>
            )}
            <button className="subtle-button" onClick={requestClose}>
              Close
            </button>
          </div>
        </div>
        {titleError && <p className="field-error">{titleError}</p>}
        {editing ? (
          <div className="stat-block-editor">
            <textarea
              value={draftBody}
              onChange={(event) => setDraftBody(event.target.value)}
              aria-label="Stat block text"
            />
            <div className="stat-block-preview">
              <RenderedStatBlock text={draftBody} />
            </div>
          </div>
        ) : (
          <div className="stat-block-preview stat-block-preview-only">
            <RenderedStatBlock text={draftBody} />
          </div>
        )}
      </div>
      {confirmDiscard && (
        <div className="modal-backdrop nested-modal" role="presentation" onClick={(event) => event.stopPropagation()}>
          <div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="discard-stat-block-title">
            <h2 id="discard-stat-block-title">Close without saving?</h2>
            <p>Your changes will be lost if you close this stat block now.</p>
            <div className="confirm-actions">
              <button className="subtle-button" onClick={() => setConfirmDiscard(false)}>
                Cancel
              </button>
              <button className="tool-button danger" onClick={onClose}>
                Close Without Saving
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RenderedStatBlock({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);

  return (
    <div className="stat-block-rendered">
      {lines.map((line, index) => {
        const heading = /^(#{1,6})\s+(.+)$/.exec(line);

        if (heading) {
          const level = heading[1].length;
          const HeadingTag = `h${level}` as keyof React.JSX.IntrinsicElements;
          return (
            <HeadingTag key={`${line}-${index}`}>
              {renderInlineStatText(heading[2])}
            </HeadingTag>
          );
        }

        if (line.trim() === "---") {
          return <hr key={`rule-${index}`} />;
        }

        if (!line.trim()) {
          return <br key={`break-${index}`} />;
        }

        return <p key={`${line}-${index}`}>{renderInlineStatText(line)}</p>;
      })}
    </div>
  );
}

function renderInlineStatText(text: string) {
  const parts: React.ReactNode[] = [];
  const pattern = /(\*\*.+?\*\*|\*.+?\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    if (token.startsWith("**")) {
      parts.push(<strong key={`${token}-${match.index}`}>{token.slice(2, -2)}</strong>);
    } else {
      parts.push(<em key={`${token}-${match.index}`}>{token.slice(1, -1)}</em>);
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

function CombatantRow({
  combatant,
  round,
  active,
  canManage,
  canEdit,
  canDrag,
  currentUserId,
  statBlocks,
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
  currentUserId: string;
  statBlocks: StatBlock[];
  hideHp: boolean;
  hideAc: boolean;
  onUpdate: (patch: Partial<Combatant>) => void;
  onRemove: () => void;
}) {
  const [addingCondition, setAddingCondition] = useState(false);
  const [conditionInput, setConditionInput] = useState("");
  const [conditionRounds, setConditionRounds] = useState("");
  const [hpActionAmount, setHpActionAmount] = useState("");
  const [nameFocused, setNameFocused] = useState(false);
  const [previewStatBlock, setPreviewStatBlock] = useState<StatBlock | null>(null);
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
  const tempHp = combatant.tempHp ?? 0;
  const concentrationPrompt = combatant.concentrationPrompt ?? null;
  const shouldShowConcentrationPrompt =
    Boolean(concentrationPrompt) && concentrationPrompt?.ownerUid === currentUserId;
  const conditionSuggestions = CONDITIONS.filter((condition) =>
    conditionLabel(condition).toLowerCase().includes(conditionInput.trim().toLowerCase()),
  );
  const matchedStatBlock = statBlocks.find(
    (statBlock) => normalizeStatBlockTitle(statBlock.title) === normalizeStatBlockTitle(combatant.name),
  );
  const statBlockNameSuggestions =
    nameFocused && combatant.name.trim()
      ? statBlocks
          .filter((statBlock) => statBlock.title.toLowerCase().includes(combatant.name.trim().toLowerCase()))
          .slice(0, 6)
      : [];

  function addCondition(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit) return;

    const rounds = Number(conditionRounds);
    const hasRounds = Number.isFinite(rounds) && rounds > 0;
    const typedCondition = conditionInput.trim();
    if (!typedCondition) return;

    const matchedCondition = CONDITIONS.find(
      (condition) => conditionLabel(condition).toLowerCase() === typedCondition.toLowerCase(),
    );
    const nextCondition: ActiveCondition = {
      id: `${matchedCondition || "custom"}-${Date.now()}`,
      name: matchedCondition || "custom",
    };

    if (!matchedCondition) {
      nextCondition.customName = typedCondition;
    }

    if (hasRounds) {
      nextCondition.rounds = rounds;
      nextCondition.expiresOnRound = round + rounds;
    }

    onUpdate({ conditions: [...conditions, nextCondition] });
    setConditionInput("");
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

    const damageToTempHp = direction === "damage" ? Math.min(tempHp, amount) : 0;
    const remainingDamage = direction === "damage" ? amount - damageToTempHp : 0;
    const nextHp =
      direction === "damage"
        ? Math.max(0, combatant.hp - remainingDamage)
        : Math.min(combatant.maxHp, combatant.hp + amount);

    const patch: Partial<Combatant> = { hp: nextHp };

    if (direction === "damage") {
      patch.tempHp = Math.max(0, tempHp - damageToTempHp);
    }

    if (direction === "damage" && conditions.some((condition) => condition.name === "concentration")) {
      patch.concentrationPrompt = {
        id: `${combatant.id}-${Date.now()}`,
        dc: Math.max(10, Math.floor(amount / 2)),
        ownerUid: combatant.ownerUid || currentUserId,
        fallbackUid: currentUserId,
      };
    }

    onUpdate(patch);
    setHpActionAmount("");
  }

  function resolveConcentrationSave(failed: boolean) {
    if (failed) {
      onUpdate({
        conditions: conditions.filter((condition) => condition.name !== "concentration"),
        concentrationPrompt: null,
      });
    } else {
      onUpdate({ concentrationPrompt: null });
    }
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
        <div className="name-combobox">
          <div className="name-input-row">
            <input
              className="name-input"
              value={combatant.name}
              placeholder="Name"
              disabled={!canManage}
              onFocus={() => setNameFocused(true)}
              onBlur={() => window.setTimeout(() => setNameFocused(false), 120)}
              onChange={(event) => onUpdate({ name: event.target.value })}
              aria-label="Combatant name"
            />
            {matchedStatBlock && (
              <button
                className="monster-link-button"
                type="button"
                title="Open stat block"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setPreviewStatBlock(matchedStatBlock)}
              >
                <MonsterIcon />
              </button>
            )}
          </div>
          {statBlockNameSuggestions.length > 0 && (
            <div className="name-suggestions">
              {statBlockNameSuggestions.map((statBlock) => (
                <button
                  key={statBlock.id}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    onUpdate({
                      name: statBlock.title,
                      ac: statBlock.ac ?? 10,
                      hp: statBlock.hp ?? 10,
                      maxHp: statBlock.hp ?? 10,
                    });
                    setNameFocused(false);
                  }}
                >
                  {statBlock.title}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="condition-tags">
          {conditions.map((condition) => (
            <button
              className="condition-chip"
              key={condition.id}
              disabled={!canEdit}
              onClick={() => removeCondition(condition.id)}
              title="Remove condition"
            >
              {activeConditionLabel(condition)}
              {condition.rounds ? ` (${conditionRoundsLeft(condition)})` : ""}
              <span aria-hidden="true">x</span>
            </button>
          ))}
          {conditions.length === 0 && <span className="no-conditions">No conditions</span>}
        </div>
        <div className="add-condition-wrap">
          {canEdit && (
            <button className="add-condition" onClick={() => setAddingCondition(true)}>
              + Add Condition
            </button>
          )}
          {addingCondition && (
            <form className="condition-menu" onSubmit={addCondition}>
              <div className="condition-combobox">
                <input
                  type="text"
                  value={conditionInput}
                  onChange={(event) => setConditionInput(event.target.value)}
                  placeholder="Condition"
                  aria-label="Condition"
                  autoComplete="off"
                />
                {conditionSuggestions.length > 0 && (
                  <div className="condition-suggestions">
                    {conditionSuggestions.map((condition) => (
                      <button
                        key={condition}
                        type="button"
                        onClick={() => setConditionInput(conditionLabel(condition))}
                      >
                        {conditionLabel(condition)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
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
              {canEdit && (
                <>
                  <input
                    className="hp-action-amount"
                    type="number"
                    min="1"
                    value={hpActionAmount}
                    onChange={(event) => setHpActionAmount(event.target.value)}
                    placeholder=""
                    aria-label="Damage or healing amount"
                  />
                  <div className="hp-action-buttons">
                    <button
                      className="mini-icon danger"
                      type="button"
                      onClick={() => applyHpDelta("damage")}
                      title="Damage"
                    >
                      <Sword aria-hidden="true" />
                    </button>
                    <button
                      className="mini-icon heal"
                      type="button"
                      onClick={() => applyHpDelta("heal")}
                      title="Heal"
                    >
                      <HeartPulse aria-hidden="true" />
                    </button>
                  </div>
                </>
              )}
              {hideHp ? (
                <label className="inline-stat-field">
                  <span>HP</span>
                  <strong>{hiddenHpStatus(combatant.hp, combatant.maxHp)}</strong>
                </label>
              ) : (
                <>
                  <label className="inline-stat-field">
                    <span>Temp HP</span>
                    <input
                      type="number"
                      value={tempHp}
                      disabled={!canEdit}
                      onChange={(event) => onUpdate({ tempHp: Number(event.target.value) })}
                      aria-label={`${combatant.name} temporary HP`}
                    />
                  </label>
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
        {canEdit && (
          <label className="field-stack">
            <span>Exh</span>
            <select
              value={exhaustionLevel}
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
        )}
      </div>
      {canManage && (
        <button className="icon-button danger" onClick={onRemove} title="Remove combatant">
          <Trash2 aria-hidden="true" />
        </button>
      )}
      {shouldShowConcentrationPrompt && concentrationPrompt && (
        <div className="modal-backdrop locked-modal" role="presentation">
          <div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="concentration-save-title">
            <h2 id="concentration-save-title">Concentration Save</h2>
            <p>
              DC <strong>{concentrationPrompt.dc}</strong>
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
      {previewStatBlock && (
        <ReadOnlyStatBlockModal statBlock={previewStatBlock} onClose={() => setPreviewStatBlock(null)} />
      )}
    </div>
  );
}

function ReadOnlyStatBlockModal({ statBlock, onClose }: { statBlock: StatBlock; onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="stat-block-modal read-only-stat-block-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="readonly-stat-block-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="stat-block-modal-header">
          <div className="stat-block-title-area">
            <h2 id="readonly-stat-block-title">{statBlock.title || "Name"}</h2>
            <div className="stat-block-core-summary">
              <span>AC {statBlock.ac ?? 10}</span>
              <span>HP {statBlock.hp ?? 10}</span>
            </div>
          </div>
          <div className="stat-block-modal-actions">
            <button className="subtle-button" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        <div className="stat-block-preview stat-block-preview-only">
          <RenderedStatBlock text={statBlock.body} />
        </div>
      </div>
    </div>
  );
}
