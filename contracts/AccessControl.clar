(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-CONSENT-REQUIRED u101)
(define-constant ERR-RESEARCHER-NOT-VERIFIED u102)
(define-constant ERR-DATA-NOT-FOUND u103)
(define-constant ERR-INVALID-ACCESS-TYPE u104)
(define-constant ERR-ACCESS-LIMIT-EXCEEDED u105)
(define-constant ERR-CONSENT-CHECK-FAILED u106)
(define-constant ERR-DATA-INACTIVE u107)

(define-data-var access-counter uint u0)
(define-data-var access-limit-per-cycle uint u10)
(define-data-var cycle-duration uint u1000)
(define-data-var last-cycle-start uint u0)
(define-data-var authority-contract principal tx-sender)

(define-map verified-researchers principal bool)
(define-map access-logs uint {
  data-id: uint,
  researcher: principal,
  patient: principal,
  access-type: (string-utf8 50),
  timestamp: uint
})
(define-map researcher-access-count { researcher: principal, cycle: uint } uint)

(define-read-only (get-access-log (log-id uint))
  (map-get? access-logs log-id)
)

(define-read-only (get-access-count-by-researcher (researcher principal))
  (let ((current-cycle (get-current-cycle)))
    (default-to u0 (map-get? researcher-access-count { researcher: researcher, cycle: current-cycle })))
)

(define-read-only (is-researcher-verified (researcher principal))
  (default-to false (map-get? verified-researchers researcher))
)

(define-private (get-current-cycle)
  (let ((current-height block-height))
    (if (>= current-height (var-get last-cycle-start))
      (/ (- current-height (var-get last-cycle-start)) (var-get cycle-duration))
      u0
    )
  )
)

(define-private (update-cycle)
  (let ((current-cycle (get-current-cycle)))
    (if (is-eq current-cycle u0)
      (begin
        (var-set last-cycle-start block-height)
        true)
      true
    )
  )
)

(define-public (verify-researcher (researcher principal))
  (begin
    (asserts! (is-eq tx-sender (var-get authority-contract)) (err ERR-NOT-AUTHORIZED))
    (map-set verified-researchers researcher true)
    (ok true)
  )
)

(define-public (set-access-limit-per-cycle (limit uint))
  (begin
    (asserts! (is-eq tx-sender (var-get authority-contract)) (err ERR-NOT-AUTHORIZED))
    (asserts! (> limit u0) (err ERR-INVALID-ACCESS-TYPE))
    (var-set access-limit-per-cycle limit)
    (ok true)
  )
)

(define-public (set-cycle-duration (duration uint))
  (begin
    (asserts! (is-eq tx-sender (var-get authority-contract)) (err ERR-NOT-AUTHORIZED))
    (asserts! (> duration u0) (err ERR-INVALID-ACCESS-TYPE))
    (var-set cycle-duration duration)
    (ok true)
  )
)

(define-public (request-access (data-id uint) (access-type (string-utf8 50)))
  (let (
      (researcher tx-sender)
      (current-cycle (get-current-cycle))
      (current-count (get-access-count-by-researcher researcher))
    )
    (try! (update-cycle))
    (asserts! (is-researcher-verified researcher) (err ERR-RESEARCHER-NOT-VERIFIED))
    (asserts! (<= current-count (var-get access-limit-per-cycle)) (err ERR-ACCESS-LIMIT-EXCEEDED))
    (asserts! (or (is-eq access-type "read-only") (is-eq access-type "read-write")) (err ERR-INVALID-ACCESS-TYPE))
    (let ((data-result (contract-call? .DataRegistry get-data data-id)))
      (match data-result
        data
        (let ((patient (get owner data)))
          (asserts! (get status data) (err ERR-DATA-INACTIVE))
          (let ((consent-result (contract-call? .ConsentManager check-consent patient data-id researcher)))
            (match consent-result
              is-consent
              (if is-consent
                (let ((log-id (var-get access-counter)))
                  (map-set access-logs log-id {
                    data-id: data-id,
                    researcher: researcher,
                    patient: patient,
                    access-type: access-type,
                    timestamp: block-height
                  })
                  (var-set access-counter (+ log-id u1))
                  (map-set researcher-access-count
                    { researcher: researcher, cycle: current-cycle }
                    (+ current-count u1)
                  )
                  (print { event: "access-granted", log-id: log-id, data-id: data-id, researcher: researcher })
                  (ok log-id)
                )
                (err ERR-CONSENT-REQUIRED)
              )
              (err ERR-CONSENT-CHECK-FAILED)
            )
          )
        )
        (err ERR-DATA-NOT-FOUND)
      )
    )
  )
)

(define-public (get-total-access-count)
  (ok (var-get access-counter))
)