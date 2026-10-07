WITH delivered AS (
  SELECT
    CAST(ts AS double)                               AS ts_sec,
    CAST(pn_rstt AS double) / 1e7                    AS msg_ts_sec,
    client_ip,
    balancer_ip,
    conn                                             AS connection_id
  FROM phonebooth_hourly.v_subscribe
  WHERE yyyy = '2026' AND mm = '10' AND dd = '06' AND hh = '00'
    AND try_cast(pn_rstt AS double) IS NOT NULL      -- skips '-' rows
)
SELECT
  from_unixtime(floor(ts_sec / 60) * 60)             AS minute_bucket,
  connection_id,
  client_ip,
  balancer_ip,
  count(*)                                           AS msgs_delivered,
  avg(ts_sec - msg_ts_sec)                           AS avg_age_sec,
  min(ts_sec - msg_ts_sec)                           AS min_age_sec,
  max(ts_sec - msg_ts_sec)                           AS max_age_sec,
  approx_percentile(ts_sec - msg_ts_sec, 0.5)        AS p50_age_sec,
  approx_percentile(ts_sec - msg_ts_sec, 0.95)       AS p95_age_sec
FROM delivered
GROUP BY 1, 2, 3, 4
ORDER BY minute_bucket, max_age_sec DESC
