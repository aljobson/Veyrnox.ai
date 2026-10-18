"use client";
import { useI18n } from '../../../components/I18nProvider.jsx';
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Button } from "../_components/Button";
import { getSession, onSessionChange } from "../../lib/authClient.js";
import { gatewayFetch } from "../_lib/gateway.js";
const identity = () => getSession()?.user?.id || "",
  empty = () => "";
const signIn = () =>
  window.dispatchEvent(new CustomEvent("veyrnox:auth-required"));
const message = (code, t) =>
  ({
    profile_required:
      t("cinema.retention.createAnActiveCinemaProfileTo"),
    account_not_active: t("cinema.comments.yourCinemaAccountIsUnavailableContact"),
    retention_not_open: t("cinema.retention.savedTitlesAndFollowsAreNot"),
    content_not_found: t("cinema.retention.thisTitleIsNoLongerAvailable"),
    rate_limited: t("cinema.retention.tooManyRequestsWaitAMinute"),
    collection_limit:
      t("cinema.retention.yourCollectionIsFullRemoveAn"),
  })[code] || t("cinema.retention.couldNotUpdateYourCollectionPlease");
export function CinemaRetentionControls({ contentId }) {
  const account = useSyncExternalStore(onSessionChange, identity, empty);
  return (
    <Controls
      key={`${account}:${contentId}`}
      account={account}
      contentId={contentId}
    />
  );
}
function Controls({ account, contentId }) {
  const { t } = useI18n();
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [closed, setClosed] = useState(false);
  const generation = useRef(0),
    attempt = useRef(null),
    pending = useRef(false);
  const load = useCallback(async () => {
    const seq = ++generation.current;
    try {
      const next = await gatewayFetch(
        `/cinema/retention?content_id=${encodeURIComponent(contentId)}`,
      );
      if (seq !== generation.current) return false;
      setData(next);
      setError("");
      setClosed(false);
      return true;
    } catch (e) {
      if (seq === generation.current) {
        setData(null);
        setClosed(
          e.code === "retention_not_open" || e.code === "content_not_found",
        );
        setError(message(e.code, t));
      }
      return false;
    }
  }, [contentId, t]);
  useEffect(() => {
    let active = true;
    const scope = generation;
    queueMicrotask(() => {
      if (active && account) void load();
    });
    return () => {
      active = false;
      scope.current++;
    };
  }, [account, load]);
  async function toggle(kind, targetId, active) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    const seq = generation.current,
      body = JSON.stringify({ kind, target_id: targetId, active: !active });
    if (attempt.current?.body !== body)
      attempt.current = { body, key: crypto.randomUUID() };
    try {
      await gatewayFetch("/cinema/retention", {
        method: "POST",
        body,
        headers: { "idempotency-key": attempt.current.key },
      });
      if (seq !== generation.current) return;
      attempt.current = null;
      await load();
    } catch (e) {
      if (seq === generation.current) setError(message(e.code, t));
    } finally {
      pending.current = false;
      if (getSession()?.user?.id === account) setBusy(false);
    }
  }
  if (!account)
    return (
      <div className="mt-4">
        <Button variant="ghost" size="sm" onClick={signIn}>
          {t("cinema.retention.signInToSaveOrFollow")}</Button>
      </div>
    );
  if (closed) return null;
  return (
    <section className="mt-4" aria-label={t("cinema.retention.saveAndFollow")} aria-busy={busy}>
      {data ? (
        <div className="flex flex-wrap gap-3">
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={data.saved}
            disabled={busy}
            onClick={() => toggle("saved", contentId, data.saved)}
          >
            {data.saved ? t("cinema.retention.removeSavedTitle") : t("cinema.retention.saveTitle")}
          </Button>
          {!data.own_creator && (
            <Button
              variant="ghost"
              size="sm"
              aria-pressed={data.following_creator}
              disabled={busy}
              onClick={() =>
                toggle("creator", data.creator_id, data.following_creator)
              }
            >
              {data.following_creator ? t("cinema.retention.unfollowCreator") : t("cinema.retention.followCreator")}
            </Button>
          )}
          {data.series_id && (
            <Button
              variant="ghost"
              size="sm"
              aria-pressed={data.following_series}
              disabled={busy}
              onClick={() =>
                toggle("series", data.series_id, data.following_series)
              }
            >
              {data.following_series ? t("cinema.retention.unfollowSeries") : t("cinema.retention.followSeries")}
            </Button>
          )}
        </div>
      ) : (
        !error && (
          <p role="status" className="text-sm text-vx-fg-muted">
            {t("cinema.retention.loadingYourCollection")}</p>
        )
      )}
      {error && (
        <div className="mt-3">
          <p role="alert">{error}</p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2"
            disabled={busy}
            onClick={load}
          >
            {t("cinema.retention.retryCollection")}</Button>
        </div>
      )}
    </section>
  );
}
export function CinemaCollection({ kind }) {
  const account = useSyncExternalStore(onSessionChange, identity, empty);
  return (
    <Collection key={`${account}:${kind}`} kind={kind} account={account} />
  );
}
function Collection({ kind, account }) {
  const { t, href: localize } = useI18n();

  const [items, setItems] = useState([]),
    [state, setState] = useState("loading"),
    [error, setError] = useState(""),
    [next, setNext] = useState(null);
  const generation = useRef(0),
    pending = useRef(false);
  const load = useCallback(
    async (cursor = null) => {
      if (cursor && pending.current) return;
      pending.current = true;
      const seq = ++generation.current;
      setState(cursor ? "more" : "loading");
      setError("");
      if (!cursor) {
        setItems([]);
        setNext(null);
      }
      try {
        const data = await gatewayFetch(
          `/cinema/retention?kind=${kind}${cursor ? `&before_id=${encodeURIComponent(cursor)}` : ""}`,
        );
        if (seq !== generation.current) return;
        setItems((old) =>
          cursor
            ? [
                ...new Map(
                  [...old, ...data.items].map((i) => [i.target_id, i]),
                ).values(),
              ]
            : data.items,
        );
        setNext(data.next);
        setState("ready");
      } catch (e) {
        if (seq === generation.current) {
          setError(message(e.code, t));
          setState(cursor ? "ready" : "error");
        }
      } finally {
        if (seq === generation.current) pending.current = false;
      }
    },
    [kind, t],
  );
  useEffect(() => {
    let active = true;
    const scope = generation;
    queueMicrotask(() => {
      if (active && account) void load();
    });
    return () => {
      active = false;
      scope.current++;
    };
  }, [account, load]);
  const heading = {
    saved: t("cinema.retention.yourSavedTitles"),
    creator: t("cinema.retention.creatorsYouFollow"),
    series: t("cinema.retention.seriesYouFollow"),
  }[kind];
  return (
    <section
      className="py-10"
      aria-label={heading}
      aria-busy={state === "loading" || state === "more"}
    >
      <h2 className="text-2xl font-extrabold">{heading}</h2>
      <p className="mt-3 text-sm text-vx-fg-muted">
        {t("cinema.retention.yourCollectionIsPrivateOnlyCurrently")}</p>
      {!account ? (
        <Button className="mt-5" onClick={signIn}>
          {t("cinema.retention.signInToSeeYourCollection")}</Button>
      ) : (
        <>
          {state === "loading" && (
            <p role="status" className="mt-5">
              {t("cinema.retention.loadingYourCollection")}</p>
          )}
          {error && (
            <div className="mt-5">
              <p role="alert">{error}</p>
              <Button
                className="mt-3"
                variant="ghost"
                onClick={() => load(next)}
              >
                {t("cinema.retention.retryCollection")}</Button>
            </div>
          )}
          {state === "ready" && !error && items.length === 0 && (
            <p role="status" className="mt-5">
              {kind === "saved"
                ? t("cinema.retention.noSavedTitlesAreAvailableYet")
                : t("cinema.retention.noFollowedStoriesAreAvailableYet")}
            </p>
          )}
          <ul className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((i) => (
              <li
                key={i.target_id}
                className="rounded-2xl border border-vx-border p-5"
                data-testid={`collection-${i.target_id}`}
              >
                <p className="text-sm text-vx-fg-muted">
                  {i.display_name} · @{i.username}
                </p>
                <h3 className="mt-2 text-xl font-bold wrap-break-word">
                  <Link
                    className="hover:underline"
                    href={localize(`/social-cinema/title/${i.content_id}`)}
                  >
                    {kind === "creator"
                      ? `${i.display_name} — ${i.title}`
                      : i.title}
                  </Link>
                </h3>
                <Link
                  className="mt-4 inline-block underline"
                  href={localize(`/social-cinema/title/${i.content_id}`)}
                >
                  {t("cinema.retention.openTitle")}</Link>
              </li>
            ))}
          </ul>
          {next && (
            <Button
              className="mt-6"
              variant="ghost"
              disabled={state === "more"}
              onClick={() => load(next)}
            >
              {state === "more" ? t("cinema.discovery.loadingMore") : t("cinema.retention.showMoreSavedStories")}
            </Button>
          )}
        </>
      )}
    </section>
  );
}
