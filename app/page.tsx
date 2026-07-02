"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  Moon,
  Plus,
  RotateCcw,
  Settings,
  Shield,
  Skull,
  SortDesc,
  Sword,
  Trash2,
  Globe2,
} from "lucide-react";
import { auth, db, firebaseReady, googleProvider } from "../lib/firebase";
import {
  Combatant,
  Condition,
  ActiveCondition,
  CalendarEvent,
  CalendarDate,
  CalendarMonth,
  CalendarWeekday,
  CampaignCalendar,
  HpVisibility,
  Room,
  Season,
  StatBlock,
  CONDITIONS,
  activeConditionLabel,
  conditionLabel,
  hiddenHpStatus,
  normalizeConditions,
} from "../lib/types";

type View = "rooms" | "room";
type RoomTab = "initiative" | "invite" | "statBlocks" | "calendar";

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
    const calendars = await getDocs(collection(db, "rooms", roomId, "calendars"));
    const batch = writeBatch(db);
    combatants.docs.forEach((combatant) => batch.delete(combatant.ref));
    statBlocks.docs.forEach((statBlock) => batch.delete(statBlock.ref));
    for (const calendar of calendars.docs) {
      const events = await getDocs(collection(db, "rooms", roomId, "calendars", calendar.id, "events"));
      events.docs.forEach((event) => batch.delete(event.ref));
      batch.delete(calendar.ref);
    }
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
    return <Shell title="Critical HIT" subtitle="Opening the war room..." />;
  }

  if (!user) {
    return <SignInScreen onSignIn={handleSignIn} />;
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setView("rooms")}>
          <Skull aria-hidden="true" />
          <span>Critical HIT</span>
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
      <h1>Critical HIT</h1>
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
  const [calendars, setCalendars] = useState<CampaignCalendar[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [activeTab, setActiveTab] = useState<RoomTab>("initiative");
  const [activeStatBlockId, setActiveStatBlockId] = useState<string | null>(null);
  const [deleteStatBlockId, setDeleteStatBlockId] = useState<string | null>(null);
  const [activeCalendarId, setActiveCalendarId] = useState<string | null>(null);
  const [deleteCalendarId, setDeleteCalendarId] = useState<string | null>(null);
  const [creatingCalendar, setCreatingCalendar] = useState(false);
  const [editingCalendarId, setEditingCalendarId] = useState<string | null>(null);

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

  useEffect(() => {
    const calendarsQuery = query(collection(db, "rooms", room.id, "calendars"));

    return onSnapshot(calendarsQuery, (snapshot) => {
      setCalendars(
        snapshot.docs
          .map((item) => ({ id: item.id, ...item.data() }) as CampaignCalendar)
          .sort((a, b) => {
            const aOrder = typeof a.order === "number" ? a.order : null;
            const bOrder = typeof b.order === "number" ? b.order : null;
            if (aOrder !== null && bOrder !== null) return aOrder - bOrder;
            if (aOrder !== null) return -1;
            if (bOrder !== null) return 1;
            return a.name.localeCompare(b.name);
          }),
      );
    });
  }, [room.id]);

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

    const order = statBlocks.length ? Math.max(...statBlocks.map((item) => item.order ?? 0)) + 1 : 0;
    const title = nextDefaultStatBlockTitle(statBlocks);
    const statBlockRef = await addDoc(collection(db, "rooms", room.id, "statBlocks"), {
      title,
      ac: 10,
      hp: 10,
      body: "**Abilities**\nAdd abilities here.",
      order,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    setActiveStatBlockId(statBlockRef.id);
  }

  async function addCalendar(calendar: Omit<CampaignCalendar, "id" | "order">) {
    if (!isCreator) return;
    const order = calendars.length ? Math.max(...calendars.map((item) => item.order ?? 0)) + 1 : 0;
    const calendarRef = await addDoc(collection(db, "rooms", room.id, "calendars"), {
      ...calendar,
      order,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    setActiveCalendarId(calendarRef.id);
    setCreatingCalendar(false);
  }

  async function updateCalendar(id: string, patch: Partial<CampaignCalendar>) {
    await updateDoc(doc(db, "rooms", room.id, "calendars", id), {
      ...patch,
      updatedAt: serverTimestamp(),
    });
  }

  async function removeCalendar(id: string) {
    if (!isCreator) return;
    const events = await getDocs(collection(db, "rooms", room.id, "calendars", id, "events"));
    const batch = writeBatch(db);
    events.docs.forEach((event) => batch.delete(event.ref));
    batch.delete(doc(db, "rooms", room.id, "calendars", id));
    await batch.commit();
    if (activeCalendarId === id) setActiveCalendarId(null);
    if (editingCalendarId === id) setEditingCalendarId(null);
    setDeleteCalendarId(null);
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

  async function handleCalendarDragEnd(event: DragEndEvent) {
    if (!isCreator) return;

    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = calendars.findIndex((calendar) => calendar.id === active.id);
    const newIndex = calendars.findIndex((calendar) => calendar.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const reordered = arrayMove(calendars, oldIndex, newIndex);
    const batch = writeBatch(db);

    reordered.forEach((calendar, index) => {
      batch.update(doc(db, "rooms", room.id, "calendars", calendar.id), {
        order: index,
        updatedAt: serverTimestamp(),
      });
    });

    await batch.commit();
  }

  async function addCalendarEvent(calendarId: string, event: Omit<CalendarEvent, "id" | "ownerUid" | "ownerEmail">) {
    if (!user.email) return;
    await addDoc(collection(db, "rooms", room.id, "calendars", calendarId, "events"), {
      ...event,
      ownerUid: user.uid,
      ownerEmail: user.email,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  async function updateCalendarEvent(calendarId: string, eventId: string, patch: Partial<CalendarEvent>) {
    await updateDoc(doc(db, "rooms", room.id, "calendars", calendarId, "events", eventId), {
      ...patch,
      updatedAt: serverTimestamp(),
    });
  }

  async function removeCalendarEvent(calendarId: string, eventId: string) {
    await deleteDoc(doc(db, "rooms", room.id, "calendars", calendarId, "events", eventId));
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
        {activeTab === "initiative" && <div className="round-display">Round {room.round}</div>}
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
        <button
          className="tab"
          onClick={() => {
            window.open("https://nexusmd.vercel.app/dashboard", "_blank", "noopener,noreferrer");
          }}
        >
          Nexus Notes
        </button>
        <button
          className={`tab${activeTab === "calendar" ? " active" : ""}`}
          onClick={() => setActiveTab("calendar")}
        >
          Calendar
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
      ) : activeTab === "calendar" ? (
        <CalendarsTab
          roomId={room.id}
          calendars={calendars}
          activeCalendarId={activeCalendarId}
          deleteCalendarId={deleteCalendarId}
          creatingCalendar={creatingCalendar}
          editingCalendarId={editingCalendarId}
          isCreator={isCreator}
          user={user}
          sensors={sensors}
          onAdd={() => setCreatingCalendar(true)}
          onCreate={addCalendar}
          onOpen={setActiveCalendarId}
          onBack={() => setActiveCalendarId(null)}
          onUpdate={updateCalendar}
          onRequestEdit={setEditingCalendarId}
          onCloseEdit={() => setEditingCalendarId(null)}
          onRequestDelete={setDeleteCalendarId}
          onCancelDelete={() => setDeleteCalendarId(null)}
          onDelete={removeCalendar}
          onDragEnd={handleCalendarDragEnd}
          onCancelCreate={() => setCreatingCalendar(false)}
          onAddEvent={addCalendarEvent}
          onUpdateEvent={updateCalendarEvent}
          onDeleteEvent={removeCalendarEvent}
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
                      onUpdateStatBlock={updateStatBlock}
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

const SEASONS: Season[] = ["spring", "summer", "autumn", "winter"];

function CalendarsTab({
  roomId,
  calendars,
  activeCalendarId,
  deleteCalendarId,
  creatingCalendar,
  editingCalendarId,
  isCreator,
  user,
  sensors,
  onAdd,
  onCreate,
  onOpen,
  onBack,
  onUpdate,
  onRequestEdit,
  onCloseEdit,
  onRequestDelete,
  onCancelDelete,
  onDelete,
  onDragEnd,
  onCancelCreate,
  onAddEvent,
  onUpdateEvent,
  onDeleteEvent,
}: {
  roomId: string;
  calendars: CampaignCalendar[];
  activeCalendarId: string | null;
  deleteCalendarId: string | null;
  creatingCalendar: boolean;
  editingCalendarId: string | null;
  isCreator: boolean;
  user: User;
  sensors: ReturnType<typeof useSensors>;
  onAdd: () => void;
  onCreate: (calendar: Omit<CampaignCalendar, "id" | "order">) => void;
  onOpen: (id: string) => void;
  onBack: () => void;
  onUpdate: (id: string, patch: Partial<CampaignCalendar>) => void;
  onRequestEdit: (id: string) => void;
  onCloseEdit: () => void;
  onRequestDelete: (id: string) => void;
  onCancelDelete: () => void;
  onDelete: (id: string) => void;
  onDragEnd: (event: DragEndEvent) => void;
  onCancelCreate: () => void;
  onAddEvent: (calendarId: string, event: Omit<CalendarEvent, "id" | "ownerUid" | "ownerEmail">) => void;
  onUpdateEvent: (calendarId: string, eventId: string, patch: Partial<CalendarEvent>) => void;
  onDeleteEvent: (calendarId: string, eventId: string) => void;
}) {
  const activeCalendar = calendars.find((calendar) => calendar.id === activeCalendarId) || null;
  const deleteCalendar = calendars.find((calendar) => calendar.id === deleteCalendarId) || null;
  const editingCalendar = calendars.find((calendar) => calendar.id === editingCalendarId) || null;

  return (
    <section className="calendars-tab">
      {activeCalendar ? (
        <CalendarView
          roomId={roomId}
          calendar={activeCalendar}
          isCreator={isCreator}
          user={user}
          onBack={onBack}
          onUpdate={(patch) => onUpdate(activeCalendar.id, patch)}
          onRequestEdit={() => onRequestEdit(activeCalendar.id)}
          onAddEvent={(event) => onAddEvent(activeCalendar.id, event)}
          onUpdateEvent={(eventId, patch) => onUpdateEvent(activeCalendar.id, eventId, patch)}
          onDeleteEvent={(eventId) => onDeleteEvent(activeCalendar.id, eventId)}
        />
      ) : (
        <>
          <div className="stat-block-toolbar">
            {isCreator && (
              <button className="tool-button" onClick={onAdd}>
                <Plus aria-hidden="true" />
                Add
              </button>
            )}
          </div>

          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={calendars.map((calendar) => calendar.id)} strategy={rectSortingStrategy}>
              <div className="stat-block-grid">
                {calendars.map((calendar) => (
                  <CalendarCard
                    key={calendar.id}
                    calendar={calendar}
                    isCreator={isCreator}
                    onOpen={onOpen}
                    onRequestDelete={onRequestDelete}
                  />
                ))}
                {calendars.length === 0 && <div className="empty-state">No calendars yet.</div>}
              </div>
            </SortableContext>
          </DndContext>
        </>
      )}

      {creatingCalendar && (
        <CalendarSettingsModal
          calendar={null}
          existingCalendars={calendars}
          onCancel={onCancelCreate}
          onSave={onCreate}
        />
      )}

      {editingCalendar && (
        <CalendarSettingsModal
          calendar={editingCalendar}
          existingCalendars={calendars}
          onCancel={onCloseEdit}
          onSave={(calendar) => {
            onUpdate(editingCalendar.id, calendar);
            onCloseEdit();
          }}
        />
      )}

      {deleteCalendar && (
        <div className="modal-backdrop" role="presentation">
          <div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delete-calendar-title">
            <h2 id="delete-calendar-title">Delete calendar?</h2>
            <p>This will remove {deleteCalendar.name || "this calendar"} and all of its events.</p>
            <div className="confirm-actions">
              <button className="subtle-button" onClick={onCancelDelete}>
                Cancel
              </button>
              <button className="tool-button danger" onClick={() => onDelete(deleteCalendar.id)}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function CalendarCard({
  calendar,
  isCreator,
  onOpen,
  onRequestDelete,
}: {
  calendar: CampaignCalendar;
  isCreator: boolean;
  onOpen: (id: string) => void;
  onRequestDelete: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: calendar.id,
    disabled: !isCreator,
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
      onClick={() => onOpen(calendar.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(calendar.id);
        }
      }}
      {...attributes}
      {...listeners}
    >
      <div className="stat-block-card-top">
        <GlobeIcon />
        {isCreator && (
          <button
            className="icon-button danger"
            title="Delete calendar"
            onPointerDown={stopCardGesture}
            onKeyDown={stopCardGesture}
            onClick={(event) => {
              event.stopPropagation();
              onRequestDelete(calendar.id);
            }}
          >
            <Trash2 aria-hidden="true" />
          </button>
        )}
      </div>
      <span>{calendar.name || "Calendar"}</span>
      <small>
        {calendar.currentYear} {calendar.eraName}
      </small>
    </div>
  );
}

function CalendarSettingsModal({
  calendar,
  existingCalendars,
  onCancel,
  onSave,
}: {
  calendar: CampaignCalendar | null;
  existingCalendars: CampaignCalendar[];
  onCancel: () => void;
  onSave: (calendar: Omit<CampaignCalendar, "id" | "order">) => void;
}) {
  const initial = calendar || createDefaultCalendar(existingCalendars);
  const [name, setName] = useState(initial.name);
  const [eraName, setEraName] = useState(initial.eraName);
  const [currentYear, setCurrentYear] = useState(initial.currentYear);
  const [daysPerWeek, setDaysPerWeek] = useState(initial.daysPerWeek);
  const [daysPerMonth, setDaysPerMonth] = useState(initial.daysPerMonth);
  const [months, setMonths] = useState<CalendarMonth[]>(sortMonths(initial.months));
  const [weekdays, setWeekdays] = useState<CalendarWeekday[]>(sortWeekdays(initial.weekdays));
  const [error, setError] = useState("");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const initialSignature = useRef(calendarSettingsSignature(initial));

  function setMonthCount(count: number) {
    const nextCount = Math.max(1, Math.min(36, count || 1));
    setMonths((current) =>
      Array.from({ length: nextCount }, (_, index) => {
        const existing = current[index];
        return existing || { id: crypto.randomUUID(), name: `Month ${index + 1}`, season: "spring", order: index };
      }).map((month, index) => ({ ...month, order: index })),
    );
  }

  function setWeekdayCount(count: number) {
    const nextCount = Math.max(1, Math.min(14, count || 1));
    setDaysPerWeek(nextCount);
    setWeekdays((current) =>
      Array.from({ length: nextCount }, (_, index) => {
        const existing = current[index];
        return existing || { id: crypto.randomUUID(), name: `Day ${index + 1}`, order: index };
      }).map((weekday, index) => ({ ...weekday, order: index })),
    );
  }

  const currentSignature = calendarSettingsSignature({
    name,
    eraName,
    currentYear,
    daysPerWeek,
    daysPerMonth,
    months,
    weekdays,
    today: initial.today,
  });
  const hasUnsavedChanges = currentSignature !== initialSignature.current;

  function requestCancel() {
    if (hasUnsavedChanges) {
      setConfirmDiscard(true);
      return;
    }

    onCancel();
  }

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Please name this calendar.");
      return;
    }

    const normalizedName = trimmedName.toLowerCase();
    if (existingCalendars.some((item) => item.id !== calendar?.id && item.name.trim().toLowerCase() === normalizedName)) {
      setError("A calendar with this name already exists.");
      return;
    }

    const sortedMonths = sortMonths(months);
    onSave({
      name: trimmedName,
      eraName: eraName.trim() || "Era",
      currentYear: Number(currentYear) || 1,
      daysPerWeek: Math.max(1, Number(daysPerWeek) || 1),
      daysPerMonth: Math.max(1, Number(daysPerMonth) || 1),
      months: sortedMonths,
      weekdays: sortWeekdays(weekdays),
      today:
        calendar?.today?.monthId && sortedMonths.some((month) => month.id === calendar.today.monthId)
          ? { ...calendar.today, year: Number(currentYear) || 1 }
          : { year: Number(currentYear) || 1, monthId: sortedMonths[0]?.id || "", day: 1 },
    });
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <form className="calendar-settings-modal" onSubmit={save}>
        <div className="stat-block-modal-header">
          <div className="stat-block-title-area">
            <h2>{calendar ? "Edit Calendar" : "Create Calendar"}</h2>
          </div>
          <div className="stat-block-modal-actions">
            <button className="tool-button" type="submit">
              Save
            </button>
            <button className="subtle-button" type="button" onClick={requestCancel}>
              Cancel
            </button>
          </div>
        </div>
        {error && <p className="field-error">{error}</p>}
        <div className="calendar-settings-grid">
          <label className="field-stack">
            <span>Name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="field-stack">
            <span>Era</span>
            <input value={eraName} onChange={(event) => setEraName(event.target.value)} />
          </label>
          <label className="field-stack">
            <span>Current Year</span>
            <input type="number" value={currentYear} onChange={(event) => setCurrentYear(Number(event.target.value))} />
          </label>
          <label className="field-stack">
            <span>Days A Week</span>
            <input type="number" min="1" max="14" value={daysPerWeek} onChange={(event) => setWeekdayCount(Number(event.target.value))} />
          </label>
          <label className="field-stack">
            <span>Days A Month</span>
            <input type="number" min="1" value={daysPerMonth} onChange={(event) => setDaysPerMonth(Number(event.target.value))} />
          </label>
          <label className="field-stack">
            <span>Months</span>
            <input type="number" min="1" max="36" value={months.length} onChange={(event) => setMonthCount(Number(event.target.value))} />
          </label>
        </div>
        <div className="calendar-settings-lists">
          <section>
            <h3>Months</h3>
            <div className="calendar-name-list">
              {months.map((month, index) => (
                <div className="calendar-name-row" key={month.id}>
                  <input
                    value={month.name}
                    onChange={(event) =>
                      setMonths(months.map((item) => (item.id === month.id ? { ...item, name: event.target.value } : item)))
                    }
                    aria-label={`Month ${index + 1} name`}
                  />
                  <select
                    value={month.season}
                    onChange={(event) =>
                      setMonths(
                        months.map((item) =>
                          item.id === month.id ? { ...item, season: event.target.value as Season } : item,
                        ),
                      )
                    }
                    aria-label={`${month.name} season`}
                  >
                    {SEASONS.map((season) => (
                      <option key={season} value={season}>
                        {titleCase(season)}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </section>
          <section>
            <h3>Weekdays</h3>
            <div className="calendar-name-list">
              {weekdays.map((weekday, index) => (
                <div className="calendar-name-row compact" key={weekday.id}>
                  <input
                    value={weekday.name}
                    onChange={(event) =>
                      setWeekdays(
                        weekdays.map((item) => (item.id === weekday.id ? { ...item, name: event.target.value } : item)),
                      )
                    }
                    aria-label={`Weekday ${index + 1} name`}
                  />
                </div>
              ))}
            </div>
          </section>
        </div>
      </form>
      {confirmDiscard && (
        <div className="modal-backdrop nested-modal" role="presentation" onClick={(event) => event.stopPropagation()}>
          <div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="discard-calendar-title">
            <h2 id="discard-calendar-title">Close without saving?</h2>
            <p>Your calendar changes will be lost if you close now.</p>
            <div className="confirm-actions">
              <button className="subtle-button" onClick={() => setConfirmDiscard(false)}>
                Cancel
              </button>
              <button className="tool-button danger" onClick={onCancel}>
                Close Without Saving
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CalendarView({
  roomId,
  calendar,
  isCreator,
  user,
  onBack,
  onUpdate,
  onRequestEdit,
  onAddEvent,
  onUpdateEvent,
  onDeleteEvent,
}: {
  roomId: string;
  calendar: CampaignCalendar;
  isCreator: boolean;
  user: User;
  onBack: () => void;
  onUpdate: (patch: Partial<CampaignCalendar>) => void;
  onRequestEdit: () => void;
  onAddEvent: (event: Omit<CalendarEvent, "id" | "ownerUid" | "ownerEmail">) => void;
  onUpdateEvent: (eventId: string, patch: Partial<CalendarEvent>) => void;
  onDeleteEvent: (eventId: string) => void;
}) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; date: CalendarDate } | null>(null);
  const [activeDay, setActiveDay] = useState<CalendarDate | null>(null);
  const [eventDraft, setEventDraft] = useState<{ date: CalendarDate; event?: CalendarEvent } | null>(null);
  const months = sortMonths(calendar.months);
  const weekdays = sortWeekdays(calendar.weekdays);

  useEffect(() => {
    return onSnapshot(collection(db, "rooms", roomId, "calendars", calendar.id, "events"), (snapshot) => {
      setEvents(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as CalendarEvent));
    });
  }, [calendar.id, roomId]);

  function setToday(date: CalendarDate) {
    onUpdate({ today: date, currentYear: date.year });
    setContextMenu(null);
  }

  function longRest() {
    const nextDate = nextCalendarDate(calendar, months);
    onUpdate({ today: nextDate, currentYear: nextDate.year });
  }

  function changeYear(delta: number) {
    const nextYear = calendar.today.year + delta;
    onUpdate({
      currentYear: nextYear,
      today: { ...calendar.today, year: nextYear },
    });
  }

  return (
    <section className="calendar-view" onClick={() => setContextMenu(null)}>
      <div className="calendar-view-toolbar">
        <button className="subtle-button" onClick={onBack}>
          <ChevronLeft aria-hidden="true" />
          Calendars
        </button>
        <div>
          <h2>{calendar.name}</h2>
          <p>
            {calendar.today.year} {calendar.eraName}
          </p>
        </div>
        <div className="calendar-year-controls">
          <button className="icon-button" onClick={() => changeYear(-10)} title="Back 10 years">
            -10
          </button>
          <button className="icon-button" onClick={() => changeYear(-1)} title="Previous year">
            <ChevronLeft aria-hidden="true" />
          </button>
          <button className="icon-button" onClick={() => changeYear(1)} title="Next year">
            <ChevronRight aria-hidden="true" />
          </button>
          <button className="icon-button" onClick={() => changeYear(10)} title="Forward 10 years">
            +10
          </button>
        </div>
        <button className="primary-action" onClick={longRest}>
          <Moon aria-hidden="true" />
          Long Rest
        </button>
        {isCreator && (
          <button className="tool-button" onClick={onRequestEdit}>
            <Settings aria-hidden="true" />
            Settings
          </button>
        )}
      </div>

      <div className="calendar-months">
        {months.map((month) => (
          <section className={`calendar-month season-${month.season}`} key={month.id}>
            <div className="calendar-month-header">
              <h3>{month.name}</h3>
              <span>{titleCase(month.season)}</span>
            </div>
            <div
              className="calendar-weekday-row"
              style={{ gridTemplateColumns: `repeat(${Math.max(1, weekdays.length)}, minmax(0, 1fr))` }}
            >
              {weekdays.map((weekday) => (
                <span key={weekday.id}>{weekday.name}</span>
              ))}
            </div>
            <div
              className="calendar-days"
              style={{ gridTemplateColumns: `repeat(${Math.max(1, weekdays.length)}, minmax(0, 1fr))` }}
            >
              {Array.from({ length: Math.max(1, calendar.daysPerMonth) }, (_, index) => {
                const day = index + 1;
                const date = { year: calendar.today.year, monthId: month.id, day };
                const dayEvents = events.filter((event) => eventMatchesDate(event, date));
                const isToday =
                  calendar.today.year === date.year &&
                  calendar.today.monthId === month.id &&
                  calendar.today.day === day;

                return (
                  <button
                    className={`calendar-day${isToday ? " today" : ""}`}
                    key={`${month.id}-${day}`}
                    type="button"
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setContextMenu({ x: event.clientX, y: event.clientY, date });
                    }}
                    onClick={() => setActiveDay(date)}
                  >
                    <span>{day}</span>
                    <div className="calendar-event-list">
                      {dayEvents.map((event) => (
                        <span
                          className="calendar-event-pill"
                          key={event.id}
                          style={{ borderColor: event.color, backgroundColor: `${event.color}33` }}
                          onClick={(clickEvent) => {
                            clickEvent.stopPropagation();
                            setEventDraft({ date, event });
                          }}
                        >
                          {event.title}
                        </span>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {contextMenu && (
        <div className="calendar-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
          <button onClick={() => setEventDraft({ date: contextMenu.date })}>Add Event</button>
          <button onClick={() => setToday(contextMenu.date)}>Set as Today</button>
        </div>
      )}

      {activeDay && (
        <CalendarDayEventsModal
          date={activeDay}
          events={events.filter((event) => eventMatchesDate(event, activeDay))}
          monthName={months.find((month) => month.id === activeDay.monthId)?.name || "Month"}
          onClose={() => setActiveDay(null)}
          onAdd={() => {
            setEventDraft({ date: activeDay });
            setActiveDay(null);
          }}
          onEdit={(event) => {
            setEventDraft({ date: activeDay, event });
            setActiveDay(null);
          }}
          onDelete={(eventId) => {
            setEvents((currentEvents) => currentEvents.filter((event) => event.id !== eventId));
            onDeleteEvent(eventId);
          }}
        />
      )}

      {eventDraft && (
        <CalendarEventModal
          event={eventDraft.event}
          date={eventDraft.date}
          user={user}
          onClose={() => setEventDraft(null)}
          onSave={(event) => {
            if (eventDraft.event) {
              setEvents((currentEvents) =>
                currentEvents.map((currentEvent) =>
                  currentEvent.id === eventDraft.event!.id ? { ...currentEvent, ...event } : currentEvent,
                ),
              );
              onUpdateEvent(eventDraft.event.id, event);
            } else {
              const optimisticEvent: CalendarEvent = {
                ...event,
                id: `pending-${Date.now()}`,
                ownerUid: user.uid,
                ownerEmail: user.email || "",
              };
              setEvents((currentEvents) => [...currentEvents, optimisticEvent]);
              Promise.resolve(onAddEvent(event)).catch(() => {
                setEvents((currentEvents) => currentEvents.filter((currentEvent) => currentEvent.id !== optimisticEvent.id));
              });
            }
            setEventDraft(null);
          }}
          onDelete={
            eventDraft.event
              ? () => {
                  onDeleteEvent(eventDraft.event!.id);
                  setEventDraft(null);
                }
              : undefined
          }
        />
      )}
    </section>
  );
}

function CalendarEventModal({
  event,
  date,
  user,
  onClose,
  onSave,
  onDelete,
}: {
  event?: CalendarEvent;
  date: CalendarDate;
  user: User;
  onClose: () => void;
  onSave: (event: Omit<CalendarEvent, "id" | "ownerUid" | "ownerEmail">) => void;
  onDelete?: () => void;
}) {
  const [title, setTitle] = useState(event?.title || "");
  const [notes, setNotes] = useState(event?.notes || "");
  const [color, setColor] = useState(event?.color || "#c51a2a");
  const [recursYearly, setRecursYearly] = useState(Boolean(event?.recursYearly));
  const [error, setError] = useState("");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const initialSignature = useRef(calendarEventSignature(event, date));
  const currentSignature = calendarEventSignature(
    {
      ...(event || {
        id: "",
        ownerUid: user.uid,
        ownerEmail: user.email || "",
      }),
      ...date,
      title,
      notes,
      color,
      recursYearly,
    },
    date,
  );
  const hasUnsavedChanges = currentSignature !== initialSignature.current;

  function requestClose() {
    if (hasUnsavedChanges) {
      setConfirmDiscard(true);
      return;
    }

    onClose();
  }

  function save(submitEvent: React.FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("Please name this event.");
      return;
    }

    onSave({
      ...date,
      title: trimmedTitle,
      notes: notes.trim(),
      color,
      recursYearly,
    });
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={requestClose}>
      <form className="calendar-event-modal" onSubmit={save} onClick={(clickEvent) => clickEvent.stopPropagation()}>
        <div className="stat-block-modal-header">
          <div className="stat-block-title-area">
            <h2>{event ? "Edit Event" : "Add Event"}</h2>
            <p>
              Day {date.day}, Year {date.year}
            </p>
          </div>
          <div className="stat-block-modal-actions">
            <button className="tool-button" type="submit">
              Save
            </button>
            <button className="subtle-button" type="button" onClick={requestClose}>
              Close
            </button>
          </div>
        </div>
        {error && <p className="field-error">{error}</p>}
        <label className="field-stack">
          <span>Title</span>
          <input value={title} onChange={(inputEvent) => setTitle(inputEvent.target.value)} />
        </label>
        <label className="calendar-checkbox">
          <input
            type="checkbox"
            checked={recursYearly}
            onChange={(inputEvent) => setRecursYearly(inputEvent.target.checked)}
          />
          <span>Recurring every year</span>
        </label>
        <label className="field-stack">
          <span>Notes</span>
          <textarea value={notes} onChange={(inputEvent) => setNotes(inputEvent.target.value)} />
        </label>
        <label className="field-stack color-field">
          <span>Color</span>
          <div className="calendar-color-control">
            <input type="color" value={color} onChange={(inputEvent) => setColor(inputEvent.target.value)} />
            <input
              type="text"
              value={color}
              onChange={(inputEvent) => setColor(inputEvent.target.value)}
              aria-label="Event color hex value"
            />
          </div>
          <div className="calendar-color-swatches">
            {["#c51a2a", "#d16728", "#d5a11f", "#2f8f4e", "#2f7fb8", "#8c4bd6", "#cf1ead"].map((swatch) => (
              <button
                key={swatch}
                type="button"
                className={color.toLowerCase() === swatch ? "active" : ""}
                style={{ backgroundColor: swatch }}
                onClick={() => setColor(swatch)}
                aria-label={`Use color ${swatch}`}
              />
            ))}
          </div>
        </label>
        <small>Created by {user.displayName || user.email}</small>
        {onDelete && (
          <button className="tool-button danger" type="button" onClick={() => setConfirmDelete(true)}>
            <Trash2 aria-hidden="true" />
            Delete Event
          </button>
        )}
      </form>
      {confirmDiscard && (
        <div className="modal-backdrop nested-modal" role="presentation" onClick={(clickEvent) => clickEvent.stopPropagation()}>
          <div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="discard-calendar-event-title">
            <h2 id="discard-calendar-event-title">Close without saving?</h2>
            <p>Your event changes will be lost if you close now.</p>
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
      {confirmDelete && onDelete && (
        <div className="modal-backdrop nested-modal" role="presentation" onClick={(clickEvent) => clickEvent.stopPropagation()}>
          <div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delete-calendar-event-title">
            <h2 id="delete-calendar-event-title">Delete event?</h2>
            <p>This will remove {title || "this event"}.</p>
            <div className="confirm-actions">
              <button className="subtle-button" onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
              <button className="tool-button danger" onClick={onDelete}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CalendarDayEventsModal({
  date,
  events,
  monthName,
  onClose,
  onAdd,
  onEdit,
  onDelete,
}: {
  date: CalendarDate;
  events: CalendarEvent[];
  monthName: string;
  onClose: () => void;
  onAdd: () => void;
  onEdit: (event: CalendarEvent) => void;
  onDelete: (eventId: string) => void;
}) {
  const [deleteEvent, setDeleteEvent] = useState<CalendarEvent | null>(null);

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className="calendar-day-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="stat-block-modal-header">
          <div className="stat-block-title-area">
            <h2>
              {monthName} {date.day}
            </h2>
            <p>Year {date.year}</p>
          </div>
          <div className="stat-block-modal-actions">
            <button className="tool-button" type="button" onClick={onAdd}>
              <Plus aria-hidden="true" />
              Add Event
            </button>
            <button className="subtle-button" type="button" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        <div className="day-event-list">
          {events.length ? (
            events.map((event) => (
              <div className="day-event-row" key={event.id}>
                <span className="event-color-dot" style={{ backgroundColor: event.color }} />
                <div>
                  <strong>{event.title}</strong>
                  {event.notes && <p>{event.notes}</p>}
                </div>
                <button className="tool-button" type="button" onClick={() => onEdit(event)}>
                  Edit
                </button>
                <button className="icon-button danger" type="button" onClick={() => setDeleteEvent(event)}>
                  <Trash2 aria-hidden="true" />
                </button>
              </div>
            ))
          ) : (
            <div className="empty-state">No events on this day.</div>
          )}
        </div>
      </div>
      {deleteEvent && (
        <div className="modal-backdrop nested-modal" role="presentation" onClick={(event) => event.stopPropagation()}>
          <div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delete-day-event-title">
            <h2 id="delete-day-event-title">Delete event?</h2>
            <p>Are you sure you want to delete {deleteEvent.title || "this event"}?</p>
            <div className="confirm-actions">
              <button className="subtle-button" onClick={() => setDeleteEvent(null)}>
                Cancel
              </button>
              <button
                className="tool-button danger"
                onClick={() => {
                  onDelete(deleteEvent.id);
                  setDeleteEvent(null);
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function createDefaultCalendar(existingCalendars: CampaignCalendar[]): Omit<CampaignCalendar, "id" | "order"> {
  const name = nextDefaultCalendarName(existingCalendars);
  const months = Array.from({ length: 12 }, (_, index) => ({
    id: crypto.randomUUID(),
    name: `Month ${index + 1}`,
    season: SEASONS[Math.floor(index / 3)] || "winter",
    order: index,
  }));
  const weekdays = Array.from({ length: 7 }, (_, index) => ({
    id: crypto.randomUUID(),
    name: `Day ${index + 1}`,
    order: index,
  }));

  return {
    name,
    eraName: "Era",
    currentYear: 1,
    daysPerWeek: 7,
    daysPerMonth: 30,
    months,
    weekdays,
    today: { year: 1, monthId: months[0].id, day: 1 },
  };
}

function calendarSettingsSignature(calendar: Omit<CampaignCalendar, "id" | "order">) {
  return JSON.stringify({
    name: calendar.name,
    eraName: calendar.eraName,
    currentYear: calendar.currentYear,
    daysPerWeek: calendar.daysPerWeek,
    daysPerMonth: calendar.daysPerMonth,
    months: sortMonths(calendar.months).map(({ id, name, season, order }) => ({ id, name, season, order })),
    weekdays: sortWeekdays(calendar.weekdays).map(({ id, name, order }) => ({ id, name, order })),
  });
}

function calendarEventSignature(event: CalendarEvent | undefined, date: CalendarDate) {
  return JSON.stringify({
    year: date.year,
    monthId: date.monthId,
    day: date.day,
    title: event?.title || "",
    notes: event?.notes || "",
    color: event?.color || "#c51a2a",
    recursYearly: Boolean(event?.recursYearly),
  });
}

function eventMatchesDate(event: CalendarEvent, date: CalendarDate) {
  if (event.monthId !== date.monthId || event.day !== date.day) return false;
  return Boolean(event.recursYearly) || event.year === date.year;
}

function nextDefaultCalendarName(calendars: CampaignCalendar[]) {
  const existingNames = new Set(calendars.map((calendar) => calendar.name.trim().toLowerCase()));
  if (!existingNames.has("calendar")) return "Calendar";

  let index = 1;
  while (existingNames.has(`calendar${index}`)) {
    index += 1;
  }

  return `Calendar${index}`;
}

function sortMonths(months: CalendarMonth[]) {
  return [...months].sort((a, b) => a.order - b.order);
}

function sortWeekdays(weekdays: CalendarWeekday[]) {
  return [...weekdays].sort((a, b) => a.order - b.order);
}

function titleCase(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function nextCalendarDate(calendar: CampaignCalendar, months: CalendarMonth[]) {
  const sortedMonths = sortMonths(months);
  const currentMonthIndex = Math.max(
    0,
    sortedMonths.findIndex((month) => month.id === calendar.today.monthId),
  );
  const currentMonth = sortedMonths[currentMonthIndex] || sortedMonths[0];
  let nextDay = calendar.today.day + 1;
  let nextMonth = currentMonth;
  let nextYear = calendar.today.year;

  if (nextDay > calendar.daysPerMonth) {
    nextDay = 1;
    const nextMonthIndex = currentMonthIndex + 1;
    if (nextMonthIndex >= sortedMonths.length) {
      nextMonth = sortedMonths[0];
      nextYear += 1;
    } else {
      nextMonth = sortedMonths[nextMonthIndex];
    }
  }

  return {
    year: nextYear,
    monthId: nextMonth?.id || currentMonth?.id || "",
    day: nextDay,
  };
}

function GlobeIcon() {
  return <Globe2 className="globe-icon" aria-hidden="true" />;
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

function nextDefaultStatBlockTitle(statBlocks: StatBlock[]) {
  const existingTitles = new Set(
    statBlocks.map((statBlock) => normalizeStatBlockTitle(statBlock.title.trim() || "Name")),
  );

  if (!existingTitles.has("name")) return "Name";

  let index = 1;
  while (existingTitles.has(`name${index}`)) {
    index += 1;
  }

  return `Name${index}`;
}

function useResizableStatBlockModal() {
  const modalRef = useRef<HTMLDivElement | null>(null);
  const [modalSize, setModalSize] = useState<React.CSSProperties>({});

  function startResize(event: React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();

    const modal = modalRef.current;
    if (!modal) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    const resizeHandle = event.currentTarget;
    const rect = modal.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const viewportPadding = 16;
    const maxWidth = Math.max(280, window.innerWidth - viewportPadding * 2);
    const maxHeight = Math.max(280, window.innerHeight - viewportPadding * 2);
    const minWidth = Math.min(544, maxWidth);
    const minHeight = Math.min(384, maxHeight);

    setModalSize({
      position: "fixed",
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      maxWidth,
      maxHeight,
    });

    function resize(pointerEvent: PointerEvent) {
      pointerEvent.preventDefault();
      pointerEvent.stopPropagation();

      const deltaX = pointerEvent.clientX - startX;
      const deltaY = pointerEvent.clientY - startY;
      const nextWidth = Math.min(maxWidth, Math.max(minWidth, rect.width + deltaX * 2));
      const nextHeight = Math.min(maxHeight, Math.max(minHeight, rect.height + deltaY * 2));
      const widthChange = nextWidth - rect.width;
      const heightChange = nextHeight - rect.height;
      const nextLeft = Math.min(
        window.innerWidth - viewportPadding - nextWidth,
        Math.max(viewportPadding, rect.left - widthChange / 2),
      );
      const nextTop = Math.min(
        window.innerHeight - viewportPadding - nextHeight,
        Math.max(viewportPadding, rect.top - heightChange / 2),
      );

      setModalSize((currentSize) => ({
        ...currentSize,
        left: nextLeft,
        top: nextTop,
        width: nextWidth,
        height: nextHeight,
      }));
    }

    function stopResize(pointerEvent: PointerEvent) {
      pointerEvent.preventDefault();
      pointerEvent.stopPropagation();
      if (resizeHandle.hasPointerCapture(pointerEvent.pointerId)) {
        resizeHandle.releasePointerCapture(pointerEvent.pointerId);
      }
      window.removeEventListener("pointermove", resize, true);
      window.removeEventListener("pointerup", stopResize, true);
      window.removeEventListener("pointercancel", stopResize, true);
    }

    window.addEventListener("pointermove", resize, true);
    window.addEventListener("pointerup", stopResize, true);
    window.addEventListener("pointercancel", stopResize, true);
  }

  return { modalRef, modalSize, startResize };
}

function StatBlockModal({
  statBlock,
  statBlocks,
  onClose,
  onUpdate,
  initialEditing = false,
}: {
  statBlock: StatBlock;
  statBlocks: StatBlock[];
  onClose: () => void;
  onUpdate: (id: string, patch: Partial<StatBlock>) => void;
  initialEditing?: boolean;
}) {
  const [draftTitle, setDraftTitle] = useState(statBlock.title);
  const [draftAc, setDraftAc] = useState(statBlock.ac ?? 10);
  const [draftHp, setDraftHp] = useState(statBlock.hp ?? 10);
  const [draftBody, setDraftBody] = useState(statBlock.body);
  const [editing, setEditing] = useState(initialEditing || (!statBlock.title && !statBlock.body));
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [titleError, setTitleError] = useState("");
  const previousStatBlockId = useRef(statBlock.id);
  const { modalRef, modalSize, startResize } = useResizableStatBlockModal();

  useEffect(() => {
    const statBlockChanged = previousStatBlockId.current !== statBlock.id;
    previousStatBlockId.current = statBlock.id;

    setDraftTitle(statBlock.title);
    setDraftAc(statBlock.ac ?? 10);
    setDraftHp(statBlock.hp ?? 10);
    setDraftBody(statBlock.body);
    if (statBlockChanged) {
      setEditing(initialEditing || (!statBlock.title && !statBlock.body));
    }
    setConfirmDiscard(false);
    setTitleError("");
  }, [statBlock.id, statBlock.title, statBlock.ac, statBlock.hp, statBlock.body, initialEditing]);

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
        ref={modalRef}
        className="stat-block-modal"
        style={modalSize}
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
                  <span>
                    <span className="stat-label">AC</span> {draftAc}
                  </span>
                  <span>
                    <span className="stat-label">HP</span> {draftHp}
                  </span>
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
        <button
          className="stat-block-resize-handle"
          type="button"
          aria-label="Resize stat block window"
          onPointerDown={startResize}
          onClick={(event) => event.stopPropagation()}
        />
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
  onUpdateStatBlock,
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
  onUpdateStatBlock: (id: string, patch: Partial<StatBlock>) => void;
  onRemove: () => void;
}) {
  const [addingCondition, setAddingCondition] = useState(false);
  const [conditionInput, setConditionInput] = useState("");
  const [conditionRounds, setConditionRounds] = useState("");
  const [hpActionAmount, setHpActionAmount] = useState("");
  const [nameFocused, setNameFocused] = useState(false);
  const [previewStatBlock, setPreviewStatBlock] = useState<StatBlock | null>(null);
  const [editingPreviewStatBlock, setEditingPreviewStatBlock] = useState(false);
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
  const currentPreviewStatBlock = previewStatBlock
    ? statBlocks.find((statBlock) => statBlock.id === previewStatBlock.id) || previewStatBlock
    : null;
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
                onClick={() => {
                  setPreviewStatBlock(matchedStatBlock);
                  setEditingPreviewStatBlock(false);
                }}
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
      {currentPreviewStatBlock && editingPreviewStatBlock && (
        <StatBlockModal
          statBlock={currentPreviewStatBlock}
          statBlocks={statBlocks}
          onClose={() => {
            setPreviewStatBlock(null);
            setEditingPreviewStatBlock(false);
          }}
          onUpdate={onUpdateStatBlock}
          initialEditing
        />
      )}
      {currentPreviewStatBlock && !editingPreviewStatBlock && (
        <ReadOnlyStatBlockModal
          statBlock={currentPreviewStatBlock}
          onClose={() => {
            setPreviewStatBlock(null);
            setEditingPreviewStatBlock(false);
          }}
          onEdit={() => setEditingPreviewStatBlock(true)}
        />
      )}
    </div>
  );
}

function ReadOnlyStatBlockModal({
  statBlock,
  onClose,
  onEdit,
}: {
  statBlock: StatBlock;
  onClose: () => void;
  onEdit: () => void;
}) {
  const { modalRef, modalSize, startResize } = useResizableStatBlockModal();

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        ref={modalRef}
        className="stat-block-modal read-only-stat-block-modal"
        style={modalSize}
        role="dialog"
        aria-modal="true"
        aria-labelledby="readonly-stat-block-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="stat-block-modal-header">
          <div className="stat-block-title-area">
            <h2 id="readonly-stat-block-title">{statBlock.title || "Name"}</h2>
            <div className="stat-block-core-summary">
              <span>
                <span className="stat-label">AC</span> {statBlock.ac ?? 10}
              </span>
              <span>
                <span className="stat-label">HP</span> {statBlock.hp ?? 10}
              </span>
            </div>
          </div>
          <div className="stat-block-modal-actions">
            <button className="tool-button" onClick={onEdit}>
              Edit
            </button>
            <button className="subtle-button" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        <div className="stat-block-preview stat-block-preview-only">
          <RenderedStatBlock text={statBlock.body} />
        </div>
        <button
          className="stat-block-resize-handle"
          type="button"
          aria-label="Resize stat block window"
          onPointerDown={startResize}
          onClick={(event) => event.stopPropagation()}
        />
      </div>
    </div>
  );
}
