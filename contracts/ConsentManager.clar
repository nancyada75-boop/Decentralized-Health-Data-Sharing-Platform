(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-INVALID-DATA-ID u101)
(define-constant ERR-INVALID-DURATION u102)
(define-constant ERR-INVALID-RESEARCHER u103)
(define-constant ERR-CONSENT-NOT-FOUND u104)
(define-constant ERR-CONSENT-EXPIRED u105)
(define-constant ERR-INVALID-PATIENT u106)
(define-constant ERR-ALREADY-REVOKED u107)
(define-constant ERR-INVALID-ACCESS-TYPE u108)
(define-constant ERR-INVALID-TIMESTAMP u109)
(define-constant ERR-MAX-CONSENTS-EXCEEDED u110)

(define-data-var consent-counter uint u0)
(define-data-var max-consents uint u10000)
(define-data-var authority-contract (optional principal) none)

(define-map consents
  { patient-id: principal, data-id: uint }
  {
    researcher: principal,
    expiry: uint,
    allowed: bool,
    access-type: (string-utf8 50),
    timestamp: uint
  }
)

(define-map consent-counts
  { patient-id: principal }
  { count: uint }
)

(define-read-only (get-consent (patient principal) (data-id uint))
  (map-get? consents { patient-id: patient, data-id: data-id })
)

(define-read-only (get-consent-count (patient principal))
  (default-to { count: u0 } (map-get? consent-counts { patient-id: patient }))
)

(define-read-only (check-consent (patient principal) (data-id uint) (researcher principal))
  (match (map-get? consents { patient-id: patient, data-id: data-id })
    consent
    (if (and (get allowed consent) (>= (get expiry consent) block-height))
      (ok true)
      (ok false))
    (ok false))
)

(define-private (validate-data-id (data-id uint))
  (if (> data-id u0)
    (ok true)
    (err ERR-INVALID-DATA-ID))
)

(define-private (validate-duration (duration uint))
  (if (> duration u0)
    (ok true)
    (err ERR-INVALID-DURATION))
)

(define-private (validate-researcher (researcher principal))
  (if (not (is-eq researcher 'SP000000000000000000002Q6VF78))
    (ok true)
    (err ERR-INVALID-RESEARCHER))
)

(define-private (validate-access-type (access-type (string-utf8 50)))
  (if (or (is-eq access-type u"read-only") (is-eq access-type u"read-write"))
    (ok true)
    (err ERR-INVALID-ACCESS-TYPE))
)

(define-private (validate-timestamp (ts uint))
  (if (>= ts block-height)
    (ok true)
    (err ERR-INVALID-TIMESTAMP))
)

(define-private (is-valid-patient (patient principal))
  true
)

(define-private (is-valid-data (patient principal) (data-id uint))
  true
)

(define-public (set-authority-contract (contract-principal principal))
  (begin
    (try! (validate-researcher contract-principal))
    (asserts! (is-none (var-get authority-contract)) (err ERR-NOT-AUTHORIZED))
    (var-set authority-contract (some contract-principal))
    (ok true)
  )
)

(define-public (set-max-consents (new-max uint))
  (begin
    (asserts! (> new-max u0) (err ERR-MAX-CONSENTS-EXCEEDED))
    (asserts! (is-some (var-get authority-contract)) (err ERR-NOT-AUTHORIZED))
    (var-set max-consents new-max)
    (ok true)
  )
)

(define-public (set-consent (data-id uint) (researcher principal) (duration uint) (access-type (string-utf8 50)))
  (let (
      (patient tx-sender)
      (consent-id (var-get consent-counter))
      (current-count (get count (get-consent-count patient)))
    )
    (asserts! (< current-count (var-get max-consents)) (err ERR-MAX-CONSENTS-EXCEEDED))
    (try! (validate-data-id data-id))
    (try! (validate-duration duration))
    (try! (validate-researcher researcher))
    (try! (validate-access-type access-type))
    (asserts! (is-valid-patient patient) (err ERR-INVALID-PATIENT))
    (asserts! (is-valid-data patient data-id) (err ERR-INVALID-DATA-ID))
    (map-set consents
      { patient-id: patient, data-id: data-id }
      {
        researcher: researcher,
        expiry: (+ block-height duration),
        allowed: true,
        access-type: access-type,
        timestamp: block-height
      }
    )
    (map-set consent-counts
      { patient-id: patient }
      { count: (+ current-count u1) }
    )
    (var-set consent-counter (+ consent-id u1))
    (print { event: "consent-set", patient: patient, data-id: data-id, researcher: researcher })
    (ok true)
  )
)

(define-public (revoke-consent (data-id uint) (researcher principal))
  (let (
      (patient tx-sender)
      (consent (map-get? consents { patient-id: patient, data-id: data-id }))
    )
    (asserts! (is-some consent) (err ERR-CONSENT-NOT-FOUND))
    (asserts! (is-valid-patient patient) (err ERR-INVALID-PATIENT))
    (asserts! (get allowed (unwrap-panic consent)) (err ERR-ALREADY-REVOKED))
    (map-set consents
      { patient-id: patient, data-id: data-id }
      {
        researcher: researcher,
        expiry: u0,
        allowed: false,
        access-type: (get access-type (unwrap-panic consent)),
        timestamp: block-height
      }
    )
    (print { event: "consent-revoked", patient: patient, data-id: data-id, researcher: researcher })
    (ok true)
  )
)