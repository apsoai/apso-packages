"""Standard Webhooks signing — including the MANDATORY official vector."""

from apso_domain_events import sign_webhook


def test_standard_webhooks_official_vector():
    # CONTRACT.md §6 — exact bytes for the payload matter.
    msg_id = "msg_p5jXN8AQM9LWM0D4loKWxJek"
    timestamp = 1614265330
    payload = '{"test": 2432232314}'
    secret = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw"

    signature = sign_webhook(msg_id, timestamp, payload, secret)

    assert signature == "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE="


def test_sign_webhook_handles_secret_without_prefix():
    # Same vector, secret with the whsec_ prefix stripped manually.
    sig_with_prefix = sign_webhook(
        "msg_p5jXN8AQM9LWM0D4loKWxJek",
        1614265330,
        '{"test": 2432232314}',
        "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw",
    )
    sig_without_prefix = sign_webhook(
        "msg_p5jXN8AQM9LWM0D4loKWxJek",
        1614265330,
        '{"test": 2432232314}',
        "MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw",
    )
    assert sig_with_prefix == sig_without_prefix
