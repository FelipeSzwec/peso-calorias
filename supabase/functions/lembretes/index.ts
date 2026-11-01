// Edge Function "lembretes": roda a cada 15 min (pg_cron) e envia as notificações do dia.
// Segredos necessários: VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT, CRON_SECRET.
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT")!, Deno.env.get("VAPID_PUBLIC")!, Deno.env.get("VAPID_PRIVATE")!);

const PDIAS: Record<string, number> = { diario: 1, semanal: 7, mensal: 30 };
const JANELA = 15; // minutos, igual ao intervalo do agendamento

function agora(tz: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date()).map((x) => [x.type, x.value]),
  );
  return { data: `${p.year}-${p.month}-${p.day}`, min: +p.hour * 60 + +p.minute };
}
const dias = (a: string, b: string) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 864e5);
const dentro = (min: number, h: number, m: number) => min >= h * 60 + m && min < h * 60 + m + JANELA;

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) return new Response("não autorizado", { status: 401 });
  const { data: subs, error } = await sb.from("push_subs").select("*");
  if (error) return new Response(error.message, { status: 500 });
  const cacheEstado = new Map<string, any>(), cachePeso = new Map<string, string | null>();
  let enviados = 0;

  for (const s of subs ?? []) {
    const t = agora(s.tz || "America/Sao_Paulo");
    if (!cacheEstado.has(s.user_id)) {
      const { data } = await sb.from("user_state").select("data").eq("user_id", s.user_id).maybeSingle();
      cacheEstado.set(s.user_id, data?.data ?? {});
    }
    const st = cacheEstado.get(s.user_id), cfg = st.settings ?? {};
    const msgs: { key: string; title: string; body: string }[] = [];

    if (cfg.lembrete) {
      if (dentro(t.min, 12, 30)) msgs.push({ key: "ref-1230", title: "Hora de lançar sua refeição", body: "Registre o que comeu em segundos." });
      if (dentro(t.min, 19, 0)) msgs.push({ key: "ref-1900", title: "Hora de lançar sua refeição", body: "Registre o que comeu em segundos." });
    }
    if (dentro(t.min, 9, 0)) {
      const datas: string[] = (st.saude ?? []).map((c: any) => c.data).filter(Boolean).sort();
      if (datas.length) {
        const u = new Date(datas[datas.length - 1] + "T12:00:00Z");
        u.setUTCFullYear(u.getUTCFullYear() + 1);
        const prox = u.toISOString().slice(0, 10), d = dias(t.data, prox);
        if ([30, 14, 7, 1, 0].includes(d) || (d < 0 && (-d) % 7 === 0)) {
          msgs.push({ key: "chk-" + prox, title: "Hora do check-up", body: d > 0 ? `Faltam ${d} dia(s) para completar 1 ano do último check-up.` : d === 0 ? "Hoje completa 1 ano do último check-up." : `O check-up está atrasado há ${-d} dia(s).` });
        }
      }
    }
    if (dentro(t.min, 8, 0) && PDIAS[cfg.pesoFreq]) {
      if (!cachePeso.has(s.user_id)) {
        const { data } = await sb.from("days").select("date").eq("user_id", s.user_id).not("peso", "is", null).order("date", { ascending: false }).limit(1);
        cachePeso.set(s.user_id, data?.[0]?.date ?? null);
      }
      const ult = cachePeso.get(s.user_id);
      if (!ult || dias(ult, t.data) >= PDIAS[cfg.pesoFreq]) msgs.push({ key: "peso", title: "Hora de se pesar", body: "Registre seu peso do dia." });
    }

    const last = { ...(s.last_sent ?? {}) };
    let mudou = false;
    for (const m of msgs) {
      if (last[m.key] === t.data) continue;
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ title: m.title, body: m.body, tag: m.key }));
        last[m.key] = t.data; mudou = true; enviados++;
      } catch (e: any) {
        if (e?.statusCode === 404 || e?.statusCode === 410) { await sb.from("push_subs").delete().eq("endpoint", s.endpoint); break; }
      }
    }
    if (mudou) await sb.from("push_subs").update({ last_sent: last }).eq("endpoint", s.endpoint);
  }
  return new Response(JSON.stringify({ enviados }), { headers: { "Content-Type": "application/json" } });
});
