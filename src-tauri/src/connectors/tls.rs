//! Certificate checks for connectors that talk to a device on the local
//! network (Synology, spec §8). Many NAS use a self-signed certificate: the
//! system store doesn't trust it, so the user is shown its SHA-256 fingerprint
//! once and may trust **that** certificate. Certificate checks are never
//! turned off: a certificate is accepted when the system trusts it, or when its
//! SHA-256 is exactly the pinned one.

use std::sync::{Arc, Mutex};

use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::WebPkiSupportedAlgorithms;
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{DigitallySignedStruct, Error as TlsError, SignatureScheme};

/// Lowercase hex SHA-256 of a DER certificate.
pub(crate) fn fingerprint(der: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(der).iter().map(|b| format!("{b:02x}")).collect()
}

/// A stored or typed fingerprint, normalised to 64 lowercase hex digits
/// (colons, spaces and case are tolerated). `None` when it isn't one.
pub(crate) fn normalize_fingerprint(s: &str) -> Option<String> {
    let hex: String = s
        .chars()
        .filter(|c| !matches!(c, ':' | ' ' | '-'))
        .map(|c| c.to_ascii_lowercase())
        .collect();
    (hex.len() == 64 && hex.chars().all(|c| c.is_ascii_hexdigit())).then_some(hex)
}

/// The fingerprint of the last certificate refused, shared with the transport
/// so a failed request can say which certificate the user may trust.
pub(crate) type SeenCert = Arc<Mutex<Option<String>>>;

/// Accepts what the system trusts, or exactly the pinned certificate.
#[derive(Debug)]
pub(crate) struct PinnedVerifier {
    system: Arc<dyn ServerCertVerifier>,
    pin: Option<String>,
    seen: SeenCert,
    algs: WebPkiSupportedAlgorithms,
}

impl PinnedVerifier {
    pub(crate) fn new(system: Arc<dyn ServerCertVerifier>, pin: Option<&str>, seen: SeenCert) -> Self {
        Self {
            system,
            pin: pin.and_then(normalize_fingerprint),
            seen,
            algs: rustls::crypto::ring::default_provider().signature_verification_algorithms,
        }
    }
}

/// A blocking HTTP client builder whose certificate check is the system
/// store or the pinned certificate (see [`PinnedVerifier`]). The returned
/// [`SeenCert`] holds the fingerprint of a refused certificate after a failed
/// request.
pub(crate) fn pinned_http_client(pin: Option<&str>) -> Result<(reqwest::blocking::ClientBuilder, SeenCert), String> {
    // Installs ring as the process default too.
    let builder = super::http_client();
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let system = rustls_platform_verifier::Verifier::new(provider.clone())
        .map_err(|e| format!("cannot read the system certificates: {e}"))?;
    let seen: SeenCert = Arc::new(Mutex::new(None));
    let verifier = PinnedVerifier::new(Arc::new(system), pin, seen.clone());
    let config = rustls::ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|e| format!("TLS setup failed: {e}"))?
        // "dangerous" is rustls' name for any custom verifier; this one still
        // checks every certificate (system store or exact pin).
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(verifier))
        .with_no_client_auth();
    Ok((builder.tls_backend_preconfigured(config), seen))
}

impl ServerCertVerifier for PinnedVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        intermediates: &[CertificateDer<'_>],
        server_name: &ServerName<'_>,
        ocsp_response: &[u8],
        now: UnixTime,
    ) -> Result<ServerCertVerified, TlsError> {
        let fp = fingerprint(end_entity);
        // Exactly the certificate the user confirmed: its host name and dates
        // don't matter (self-signed NAS certificates often have neither right).
        if self.pin.as_deref() == Some(fp.as_str()) {
            return Ok(ServerCertVerified::assertion());
        }
        match self.system.verify_server_cert(end_entity, intermediates, server_name, ocsp_response, now) {
            Ok(ok) => Ok(ok),
            Err(e) => {
                if matches!(e, TlsError::InvalidCertificate(_)) {
                    if let Ok(mut seen) = self.seen.lock() {
                        *seen = Some(fp);
                    }
                }
                Err(e)
            }
        }
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, TlsError> {
        rustls::crypto::verify_tls12_signature(message, cert, dss, &self.algs)
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, TlsError> {
        rustls::crypto::verify_tls13_signature(message, cert, dss, &self.algs)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.algs.supported_schemes()
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// Stands in for the system store refusing a self-signed certificate.
    #[derive(Debug)]
    pub(crate) struct SystemRefuses;
    impl ServerCertVerifier for SystemRefuses {
        fn verify_server_cert(
            &self,
            _: &CertificateDer<'_>,
            _: &[CertificateDer<'_>],
            _: &ServerName<'_>,
            _: &[u8],
            _: UnixTime,
        ) -> Result<ServerCertVerified, TlsError> {
            Err(TlsError::InvalidCertificate(rustls::CertificateError::UnknownIssuer))
        }
        fn verify_tls12_signature(
            &self,
            _: &[u8],
            _: &CertificateDer<'_>,
            _: &DigitallySignedStruct,
        ) -> Result<HandshakeSignatureValid, TlsError> {
            unreachable!()
        }
        fn verify_tls13_signature(
            &self,
            _: &[u8],
            _: &CertificateDer<'_>,
            _: &DigitallySignedStruct,
        ) -> Result<HandshakeSignatureValid, TlsError> {
            unreachable!()
        }
        fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
            vec![]
        }
    }

    /// Stands in for a certificate the system trusts.
    #[derive(Debug)]
    struct SystemTrusts;
    impl ServerCertVerifier for SystemTrusts {
        fn verify_server_cert(
            &self,
            _: &CertificateDer<'_>,
            _: &[CertificateDer<'_>],
            _: &ServerName<'_>,
            _: &[u8],
            _: UnixTime,
        ) -> Result<ServerCertVerified, TlsError> {
            Ok(ServerCertVerified::assertion())
        }
        fn verify_tls12_signature(
            &self,
            _: &[u8],
            _: &CertificateDer<'_>,
            _: &DigitallySignedStruct,
        ) -> Result<HandshakeSignatureValid, TlsError> {
            unreachable!()
        }
        fn verify_tls13_signature(
            &self,
            _: &[u8],
            _: &CertificateDer<'_>,
            _: &DigitallySignedStruct,
        ) -> Result<HandshakeSignatureValid, TlsError> {
            unreachable!()
        }
        fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
            vec![]
        }
    }

    /// A fresh self-signed certificate (DER), as a NAS would present.
    pub(crate) fn self_signed(name: &str) -> CertificateDer<'static> {
        rcgen::generate_simple_self_signed(vec![name.to_string()]).unwrap().cert.der().clone()
    }

    pub(crate) fn verify(v: &PinnedVerifier, cert: &CertificateDer<'_>, host: &str) -> Result<ServerCertVerified, TlsError> {
        let name = ServerName::try_from(host.to_string()).unwrap();
        v.verify_server_cert(cert, &[], &name, &[], UnixTime::now())
    }

    fn seen() -> SeenCert {
        Arc::new(Mutex::new(None))
    }

    #[test]
    fn fingerprint_is_lowercase_hex_sha256() {
        assert_eq!(fingerprint(b"abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }

    #[test]
    fn normalizes_typed_fingerprints() {
        let fp = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
        let colons = "BA:78:16:BF:8F:01:CF:EA:41:41:40:DE:5D:AE:22:23:B0:03:61:A3:96:17:7A:9C:B4:10:FF:61:F2:00:15:AD";
        assert_eq!(normalize_fingerprint(colons).as_deref(), Some(fp));
        assert_eq!(normalize_fingerprint(fp).as_deref(), Some(fp));
        assert_eq!(normalize_fingerprint("abc"), None);
        assert_eq!(normalize_fingerprint(&"zz".repeat(32)), None);
    }

    #[test]
    fn pinned_certificate_is_accepted_whatever_the_host_name() {
        let cert = self_signed("nas.local");
        let fp = fingerprint(&cert);
        let v = PinnedVerifier::new(Arc::new(SystemRefuses), Some(&fp), seen());
        assert!(verify(&v, &cert, "192-168-1-20.example").is_ok());
    }

    #[test]
    fn another_certificate_is_refused_and_its_fingerprint_recorded() {
        let trusted = self_signed("nas.local");
        let other = self_signed("nas.local");
        let s = seen();
        let v = PinnedVerifier::new(Arc::new(SystemRefuses), Some(&fingerprint(&trusted)), s.clone());
        assert!(verify(&v, &other, "nas.local").is_err());
        assert_eq!(s.lock().unwrap().clone(), Some(fingerprint(&other)));
    }

    #[test]
    fn without_a_pin_an_untrusted_certificate_is_refused() {
        let cert = self_signed("nas.local");
        let s = seen();
        let v = PinnedVerifier::new(Arc::new(SystemRefuses), None, s.clone());
        assert!(verify(&v, &cert, "nas.local").is_err());
        assert_eq!(s.lock().unwrap().clone(), Some(fingerprint(&cert)));
    }

    #[test]
    fn a_certificate_the_system_trusts_is_accepted() {
        let cert = self_signed("nas.local");
        let s = seen();
        let v = PinnedVerifier::new(Arc::new(SystemTrusts), None, s.clone());
        assert!(verify(&v, &cert, "nas.local").is_ok());
        assert_eq!(s.lock().unwrap().clone(), None);
    }

    #[test]
    fn a_malformed_pin_pins_nothing() {
        let cert = self_signed("nas.local");
        let v = PinnedVerifier::new(Arc::new(SystemRefuses), Some("not-a-fingerprint"), seen());
        assert!(verify(&v, &cert, "nas.local").is_err());
    }
}
