use serde::{Serialize, Deserialize};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use tracing::error;

/// Network interface information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkInterface {
    pub name: String,
    pub addresses: Vec<IpAddress>,
    pub is_up: bool,
    pub is_loopback: bool,
}

/// IP address with type information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpAddress {
    pub address: String,
    pub is_ipv4: bool,
    pub is_ipv6: bool,
    pub is_private: bool,
}

/// Network utilities
pub struct NetworkUtils;

impl NetworkUtils {
    /// Get the primary local IP address
    pub fn get_local_ip_address() -> Option<String> {
        // Try to get network interfaces
        let interfaces = Self::get_all_interfaces();
        
        // First, try to find a private network address (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
        for interface in &interfaces {
            if interface.is_loopback || !interface.is_up {
                continue;
            }
            
            for addr in &interface.addresses {
                if addr.is_ipv4 && addr.is_private {
                    return Some(addr.address.clone());
                }
            }
        }
        
        // If no private address found, return any non-loopback IPv4
        for interface in &interfaces {
            if interface.is_loopback || !interface.is_up {
                continue;
            }
            
            for addr in &interface.addresses {
                if addr.is_ipv4 {
                    return Some(addr.address.clone());
                }
            }
        }
        
        None
    }
    
    /// Get all IP addresses
    pub fn get_all_ip_addresses() -> Vec<String> {
        let interfaces = Self::get_all_interfaces();
        let mut addresses = Vec::new();
        
        for interface in interfaces {
            if interface.is_loopback {
                continue;
            }
            
            for addr in interface.addresses {
                addresses.push(addr.address);
            }
        }
        
        addresses
    }
    
    /// Get all network interfaces
    pub fn get_all_interfaces() -> Vec<NetworkInterface> {
        #[cfg(unix)]
        {
            Self::get_interfaces_unix()
        }
        
        #[cfg(windows)]
        {
            Self::get_interfaces_windows()
        }
        
        #[cfg(not(any(unix, windows)))]
        {
            Vec::new()
        }
    }
    
    #[cfg(unix)]
    fn get_interfaces_unix() -> Vec<NetworkInterface> {
        use nix::ifaddrs::getifaddrs;
        
        let mut interfaces = std::collections::HashMap::new();
        
        match getifaddrs() {
            Ok(addrs) => {
                for ifaddr in addrs {
                    let name = ifaddr.interface_name.clone();
                    let flags = ifaddr.flags;
                    
                    let interface = interfaces.entry(name.clone()).or_insert_with(|| NetworkInterface {
                        name,
                        addresses: Vec::new(),
                        is_up: flags.contains(nix::net::if_::InterfaceFlags::IFF_UP),
                        is_loopback: flags.contains(nix::net::if_::InterfaceFlags::IFF_LOOPBACK),
                    });
                    
                    if let Some(address) = ifaddr.address {
                        if let Some(sockaddr) = address.as_sockaddr_in() {
                            let ip = IpAddr::V4(Ipv4Addr::from(sockaddr.ip()));
                            interface.addresses.push(IpAddress {
                                address: ip.to_string(),
                                is_ipv4: true,
                                is_ipv6: false,
                                is_private: Self::is_private_ip(&ip),
                            });
                        } else if let Some(sockaddr) = address.as_sockaddr_in6() {
                            let ip = IpAddr::V6(sockaddr.ip());
                            interface.addresses.push(IpAddress {
                                address: ip.to_string(),
                                is_ipv4: false,
                                is_ipv6: true,
                                is_private: Self::is_private_ip(&ip),
                            });
                        }
                    }
                }
            }
            Err(e) => {
                error!("Failed to get network interfaces: {}", e);
            }
        }
        
        interfaces.into_values().collect()
    }
    
    #[cfg(windows)]
    fn get_interfaces_windows() -> Vec<NetworkInterface> {
        use ipconfig::get_adapters;
        
        let mut interfaces = Vec::new();
        
        match get_adapters() {
            Ok(adapters) => {
                for adapter in adapters {
                    let mut addresses = Vec::new();
                    
                    // Get IPv4 addresses
                    for addr in adapter.ipv4_addresses() {
                        addresses.push(IpAddress {
                            address: addr.to_string(),
                            is_ipv4: true,
                            is_ipv6: false,
                            is_private: Self::is_private_ipv4(addr),
                        });
                    }
                    
                    // Get IPv6 addresses
                    for addr in adapter.ipv6_addresses() {
                        addresses.push(IpAddress {
                            address: addr.to_string(),
                            is_ipv4: false,
                            is_ipv6: true,
                            is_private: Self::is_private_ipv6(addr),
                        });
                    }
                    
                    interfaces.push(NetworkInterface {
                        name: adapter.friendly_name().to_string(),
                        addresses,
                        is_up: adapter.oper_status() == ipconfig::OperStatus::IfOperStatusUp,
                        is_loopback: adapter.if_type() == ipconfig::IfType::SoftwareLoopback,
                    });
                }
            }
            Err(e) => {
                error!("Failed to get network interfaces: {}", e);
            }
        }
        
        interfaces
    }
    
    /// Check if an IP address is private
    fn is_private_ip(ip: &IpAddr) -> bool {
        match ip {
            IpAddr::V4(ipv4) => Self::is_private_ipv4(ipv4),
            IpAddr::V6(ipv6) => Self::is_private_ipv6(ipv6),
        }
    }
    
    /// Check if an IPv4 address is private
    fn is_private_ipv4(ip: &Ipv4Addr) -> bool {
        let octets = ip.octets();
        
        // 10.0.0.0/8
        if octets[0] == 10 {
            return true;
        }
        
        // 172.16.0.0/12
        if octets[0] == 172 && (octets[1] >= 16 && octets[1] <= 31) {
            return true;
        }
        
        // 192.168.0.0/16
        if octets[0] == 192 && octets[1] == 168 {
            return true;
        }
        
        false
    }
    
    /// Check if an IPv6 address is private
    fn is_private_ipv6(ip: &Ipv6Addr) -> bool {
        // Check for link-local addresses (fe80::/10)
        let segments = ip.segments();
        if segments[0] & 0xffc0 == 0xfe80 {
            return true;
        }
        
        // Check for unique local addresses (fc00::/7)
        if segments[0] & 0xfe00 == 0xfc00 {
            return true;
        }
        
        false
    }
    
    /// Get hostname
    pub fn get_hostname() -> Option<String> {
        hostname::get()
            .ok()
            .and_then(|name| name.into_string().ok())
    }
    
    /// Test network connectivity to a host
    pub async fn test_connectivity(host: &str, port: u16) -> bool {
        use tokio::net::TcpStream;
        use tokio::time::timeout;
        use std::time::Duration;
        
        let addr = format!("{}:{}", host, port);
        match timeout(Duration::from_secs(3), TcpStream::connect(&addr)).await {
            Ok(Ok(_)) => true,
            _ => false,
        }
    }
    
    /// Get network statistics
    pub fn get_network_stats() -> NetworkStats {
        NetworkStats {
            hostname: Self::get_hostname(),
            primary_ip: Self::get_local_ip_address(),
            all_ips: Self::get_all_ip_addresses(),
            interface_count: Self::get_all_interfaces().len(),
        }
    }
}

/// Network statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkStats {
    pub hostname: Option<String>,
    pub primary_ip: Option<String>,
    pub all_ips: Vec<String>,
    pub interface_count: usize,
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_private_ipv4() {
        assert!(NetworkUtils::is_private_ipv4(&"10.0.0.1".parse().unwrap()));
        assert!(NetworkUtils::is_private_ipv4(&"172.16.0.1".parse().unwrap()));
        assert!(NetworkUtils::is_private_ipv4(&"192.168.1.1".parse().unwrap()));
        assert!(!NetworkUtils::is_private_ipv4(&"8.8.8.8".parse().unwrap()));
    }
}