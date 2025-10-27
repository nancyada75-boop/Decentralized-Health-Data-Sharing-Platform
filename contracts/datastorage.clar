(define-constant ERR-NOT-AUTHORIZED u200)
(define-constant ERR-INVALID-DATA-ID u201)
(define-constant ERR-INVALID-HASH u202)
(define-constant ERR-INVALID-DATA-TYPE u203)
(define-constant ERR-INVALID-DESCRIPTION u204)
(define-constant ERR-DATA-NOT-FOUND u205)
(define-constant ERR-MAX-DATA-EXCEEDED u206)

(define-data-var max-data-per-patient uint u1000)

(define-map data-entries
  { patient-id: principal, data-id: uint }
  {
    hash: (string-ascii 64),
    data-type: (string-utf8 50),
    description: (string-utf8 200),
    timestamp: uint,
    version: uint
  }
)

(define-map data-counters
  principal
  uint
)

(define-read-only (get-data-entry (patient principal) (data-id uint))
  (map-get? data-entries { patient-id: patient, data-id: data-id })
)

(define-read-only (get-data-count (patient principal))
  (default-to u0 (map-get? data-counters patient))
)

(define-private (validate-hash (hash (string-ascii 64)))
  (if (is-eq (len hash) u64)
    (ok true)
    (err ERR-INVALID-HASH))
)

(define-private (validate-data-type (data-type (string-utf8 50)))
  (if (or
        (is-eq data-type u"clinical")
        (is-eq data-type u"wearable")
        (is-eq data-type u"genomic")
        (is-eq data-type u"lifestyle")
        (is-eq data-type u"imaging")
        (is-eq data-type u"lab"))
    (ok true)
    (err ERR-INVALID-DATA-TYPE))
)

(define-private (validate-description (desc (string-utf8 200)))
  (if (<= (len desc) u200)
    (ok true)
    (err ERR-INVALID-DESCRIPTION))
)

(define-public (register-data
    (hash (string-ascii 64))
    (data-type (string-utf8 50))
    (description (string-utf8 200)))
  (let (
      (patient tx-sender)
      (current-count (get-data-count patient))
      (new-id (+ current-count u1))
    )
    (asserts! (<= new-id (var-get max-data-per-patient)) (err ERR-MAX-DATA-EXCEEDED))
    (try! (validate-hash hash))
    (try! (validate-data-type data-type))
    (try! (validate-description description))
    (map-set data-entries
      { patient-id: patient, data-id: new-id }
      {
        hash: hash,
        data-type: data-type,
        description: description,
        timestamp: block-height,
        version: u1
      }
    )
    (map-set data-counters patient new-id)
    (print { event: "data-registered", patient: patient, data-id: new-id, hash: hash })
    (ok new-id)
  )
)

(define-public (update-metadata
    (data-id uint)
    (data-type (string-utf8 50))
    (description (string-utf8 200)))
  (let (
      (patient tx-sender)
      (entry (map-get? data-entries { patient-id: patient, data-id: data-id }))
    )
    (asserts! (is-some entry) (err ERR-DATA-NOT-FOUND))
    (try! (validate-data-type data-type))
    (try! (validate-description description))
    (map-set data-entries
      { patient-id: patient, data-id: data-id }
      (merge (unwrap-panic entry)
        {
          data-type: data-type,
          description: description,
          version: (+ (get version (unwrap-panic entry)) u1)
        }
      )
    )
    (print { event: "metadata-updated", patient: patient, data-id: data-id })
    (ok true)
  )
)