import React, { useEffect, useState } from 'react';
import {
  Layout,
  Card,
  Typography,
  TimePicker,
  Space,
  Progress,
  Alert,
  Grid,
  Menu,
  Message,
  Button,
  Badge
} from '@arco-design/web-react';
import { IconExclamationCircle, IconHome } from '@arco-design/web-react/icon';
import { TimePicker as AntTimePicker } from 'antd';
import { ClockCircleOutlined } from '@ant-design/icons';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import axios from 'axios';
import dayjs, { Dayjs } from 'dayjs';
import { motion, AnimatePresence } from 'framer-motion';
import 'antd/dist/reset.css';

// Animation variants
const pageTransition = {
  hidden: { opacity: 0 },
  visible: { 
    opacity: 1,
    transition: { 
      duration: 0.5,
      when: "beforeChildren",
      staggerChildren: 0.2
    }
  }
};

const cardVariants = {
  hidden: { y: 20, opacity: 0 },
  visible: { 
    y: 0, 
    opacity: 1,
    transition: { 
      type: "spring", 
      stiffness: 100,
      damping: 15
    }
  }
};

const itemVariants = {
  hidden: { y: 10, opacity: 0 },
  visible: { 
    y: 0, 
    opacity: 1,
    transition: { type: "spring", stiffness: 100 }
  }
};

const pulseAnimation = {
  scale: [1, 1.02, 1],
  transition: {
    duration: 2,
    repeat: Infinity,
    repeatType: "reverse" as const
  }
};

// Enhanced hover animations
const cardHoverVariants = {
  initial: { 
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.1)",
    y: 0,
    scale: 1
  },
  hover: { 
    boxShadow: "0 12px 24px rgba(0, 0, 0, 0.15)", 
    y: -5,
    scale: 1.02,
    transition: {
      type: "spring",
      stiffness: 300,
      damping: 20
    }
  }
};

const buttonHoverVariants = {
  initial: { scale: 1, boxShadow: "0 2px 6px rgba(0, 0, 0, 0.1)" },
  hover: { 
    scale: 1.05, 
    boxShadow: "0 5px 15px rgba(0, 0, 0, 0.15)",
    transition: {
      type: "spring",
      stiffness: 400,
      damping: 15
    }
  },
  tap: { scale: 0.95 }
};

const textHoverVariants = {
  initial: { 
    letterSpacing: "0px", 
    y: 0,
    color: "inherit"
  },
  hover: { 
    letterSpacing: "0.5px", 
    y: -2,
    fontWeight: 500,
    transition: {
      type: "spring",
      stiffness: 300,
      damping: 15
    }
  }
};

const badgeHoverVariants = {
  initial: { 
    scale: 1, 
    y: 0
  },
  hover: { 
    scale: 1.08, 
    y: -3,
    transition: {
      type: "spring",
      stiffness: 400,
      damping: 10
    }
  }
};

// SVG pattern for background
const backgroundPattern = `
<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 60 60">
  <g fill="none" fill-rule="evenodd">
    <g fill="#f0f2f5" fill-opacity="0.4">
      <path d="M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z"/>
    </g>
  </g>
</svg>
`;

const encodedPattern = encodeURIComponent(backgroundPattern);
const backgroundUrl = `url("data:image/svg+xml;utf8,${encodedPattern}")`;

const { Content, Sider } = Layout;
const { Title, Text } = Typography;
const { Row, Col } = Grid;
const MenuItem = Menu.Item;

interface DeviceStatus {
  id: number;
  last_seen: string;
  error_code?: string;
  co2_level: number;
  sound_level: number;
  alarm_active: boolean;
  alarm_active_time: number;
  current_time: number;
  alarm_enabled: boolean;
}

interface AlarmTime {
  time: string;
}

interface SensorData {
  timestamp: string;
  co2_level: number;
}

const API_URL = '';
const UPDATE_INTERVAL = 300; // 5 minutes in seconds

// Add new interface for CO2 thresholds
const CO2_THRESHOLDS = {
  GOOD: 800,
  MODERATE: 1000,
  HIGH: 1500,
};

// Helper function to check if device is connected
const isDeviceConnected = (lastSeen: string | null): boolean => {
  if (!lastSeen) return false;
  const lastSeenDate = new Date(lastSeen);
  return !isNaN(lastSeenDate.getTime()) && lastSeenDate.getFullYear() >= 2000;
};

function getCO2Color(level: number): string {
  if (level <= CO2_THRESHOLDS.GOOD) return '#4CAF50';
  if (level <= CO2_THRESHOLDS.MODERATE) return '#FFC107';
  if (level <= CO2_THRESHOLDS.HIGH) return '#FF9800';
  return '#F44336';
}

function App() {
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus | null>(null);
  const [alarmTime, setAlarmTime] = useState<AlarmTime | null>(null);
  const [sensorData, setSensorData] = useState<SensorData[]>([]);
  const [progress, setProgress] = useState(100);
  const [lastUpdateTime, setLastUpdateTime] = useState<Date | null>(null);
  const [timePickerValue, setTimePickerValue] = useState<Dayjs | undefined>(
    alarmTime?.time ? dayjs(alarmTime.time, 'HH:mm') : dayjs('10:30', 'HH:mm')
  );
  const [collapsed, setCollapsed] = useState(false);

  const fetchDeviceStatus = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/device/status`);
      setDeviceStatus(response.data);
      setLastUpdateTime(new Date(response.data.last_seen));
    } catch (error) {
      console.error('Error fetching device status:', error);
    }
  };

  const fetchAlarmTime = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/alarm`);
      setAlarmTime(response.data);
    } catch (error) {
      console.error('Error fetching alarm time:', error);
    }
  };

  const fetchSensorData = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/sensor-data`);
      setSensorData(response.data);
    } catch (error) {
      console.error('Error fetching sensor data:', error);
    }
  };

  const updateAlarmTime = async (timeToSet: string) => {
    try {
      await axios.post(`${API_URL}/api/alarm`, { time: timeToSet });
      await fetchAlarmTime();
      window.alert('Alarm time updated successfully');
    } catch (error) {
      console.error('Error updating alarm time:', error);
      window.alert('Failed to update alarm time');
      // Reset the time picker value to the previous valid state
      if (alarmTime?.time) {
        setTimePickerValue(dayjs(alarmTime.time, 'HH:mm'));
      }
    }
  };

  const handleEnableAlarm = async () => {
    try {
      await axios.post(`${API_URL}/api/alarm/enable`);
      Message.success('Alarm enabled successfully');
      await fetchDeviceStatus();
    } catch (error) {
      console.error('Error enabling alarm:', error);
      Message.error('Failed to enable alarm');
    }
  };

  const handleDisableAlarm = async () => {
    try {
      await axios.post(`${API_URL}/api/alarm/disable`);
      Message.success('Alarm disabled successfully');
      await fetchDeviceStatus();
    } catch (error) {
      console.error('Error disabling alarm:', error);
      Message.error('Failed to disable alarm');
    }
  };

  useEffect(() => {
    fetchDeviceStatus();
    fetchAlarmTime();
    fetchSensorData();

    const interval = setInterval(() => {
      fetchDeviceStatus();
      fetchSensorData();
    }, 30000); // Refresh every 30 seconds

    return () => clearInterval(interval);
  }, []);

  // Update progress bar
  useEffect(() => {
    if (!lastUpdateTime) return;

    const updateProgress = () => {
      const now = new Date();
      const diff = (now.getTime() - lastUpdateTime.getTime()) / 1000;
      const newProgress = Math.max(0, 100 - (diff / UPDATE_INTERVAL) * 100);
      setProgress(newProgress);
    };

    const interval = setInterval(updateProgress, 1000);
    updateProgress();

    return () => clearInterval(interval);
  }, [lastUpdateTime]);

  // Update timePickerValue when alarmTime changes
  useEffect(() => {
    if (alarmTime?.time) {
      setTimePickerValue(dayjs(alarmTime.time, 'HH:mm'));
    }
  }, [alarmTime]);

  const isUpdateOverdue = progress === 0;

  const onCollapse = (collapsed: boolean, type: 'responsive' | 'clickTrigger') => {
    setCollapsed(collapsed);
  };

  return (
    <motion.div 
      initial="hidden"
      animate="visible"
      variants={pageTransition}
    >
      <Layout style={{ 
        minHeight: '100vh',
        background: `radial-gradient(circle at top left, rgba(230, 244, 255, 0.8) 0%, rgba(255, 255, 255, 0.9) 50%, rgba(240, 245, 255, 0.85) 100%), ${backgroundUrl}`,
        backgroundSize: '60px 60px',
        backgroundAttachment: 'fixed'
      }}>
        <Sider
          theme='dark'
          breakpoint='lg'
          onCollapse={onCollapse}
          collapsed={collapsed}
          width={220}
          collapsible
          style={{ 
            boxShadow: '2px 0 8px rgba(0, 0, 0, 0.1)',
            zIndex: 10
          }}
        >
          <motion.div
            initial={{ x: -50, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ delay: 0.2, type: "spring", stiffness: 100 }}
          >
            <Menu
              theme='dark'
              defaultSelectedKeys={['waku']}
              style={{ width: '100%' }}
            >
              <MenuItem key='waku'>
                <IconHome />
                <motion.span
                  animate={{ opacity: collapsed ? 0 : 1 }}
                  transition={{ duration: 0.2 }}
                >
                  Waku
                </motion.span>
              </MenuItem>
            </Menu>
          </motion.div>
        </Sider>
        <Layout>
          <Content style={{ padding: '20px' }}>
            <motion.div
              initial={{ y: -20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ type: "spring", stiffness: 100 }}
            >
              <Title heading={2}>Home</Title>
            </motion.div>

            <Space direction="vertical" size="large" style={{ width: '100%', display: 'flex' }}>
              {/* Device Status Card */}
              <motion.div 
                variants={cardVariants}
                whileHover="hover"
                initial="initial"
              >
                <Card 
                  title={
                    <motion.div 
                      initial={{ x: -10, opacity: 0 }} 
                      animate={{ x: 0, opacity: 1 }}
                      transition={{ delay: 0.1 }}
                      whileHover={{ x: 3, transition: { duration: 0.3 } }}
                    >
                      Device Status
                    </motion.div>
                  }
                  style={{ 
                    borderRadius: '12px',
                    overflow: 'hidden',
                    backdropFilter: 'blur(8px)',
                    backgroundColor: 'rgba(255, 255, 255, 0.9)',
                    transition: 'all 0.3s ease-in-out'
                  }}
                  className="status-card"
                >
                  <AnimatePresence mode="wait">
                    {deviceStatus ? (
                      <motion.div 
                        key="device-status-content"
                        variants={itemVariants}
                        initial="hidden"
                        animate="visible"
                        exit={{ opacity: 0, y: -10 }}
                      >
                        <Space direction="vertical" style={{ width: '100%' }}>
                          <motion.div 
                            variants={itemVariants}
                            whileHover={textHoverVariants.hover}
                            initial={textHoverVariants.initial}
                          >
                            <Text>Last Seen: {isDeviceConnected(deviceStatus.last_seen) ? 
                              new Date(deviceStatus.last_seen).toLocaleString() : 
                              "Not Connected"}</Text>
                          </motion.div>
                          <motion.div variants={itemVariants}>
                            <Progress
                              percent={progress}
                              status={isUpdateOverdue ? 'error' : 'normal'}
                              formatText={() => `${Math.round(progress)}%`}
                              animation
                            />
                          </motion.div>
                          {deviceStatus.error_code && (
                            <motion.div 
                              variants={itemVariants}
                              animate={deviceStatus.error_code !== "NO_ERROR" ? pulseAnimation : {}}
                              whileHover={{ 
                                scale: deviceStatus.error_code !== "NO_ERROR" ? 1.05 : 1.03,
                                y: -3,
                                transition: { type: "spring", stiffness: 400 }
                              }}
                            >
                              <Alert
                                type={deviceStatus.error_code === "NO_ERROR" ? "success" : "error"}
                                content={deviceStatus.error_code === "NO_ERROR" ? "DEVICE OPERATES CORRECTLY" : deviceStatus.error_code}
                                icon={<IconExclamationCircle />}
                              />
                            </motion.div>
                          )}
                          <Space direction="vertical" size="small">
                            <motion.div variants={itemVariants}>
                              <Space align="center">
                                {isDeviceConnected(deviceStatus.last_seen) ? (
                                  <motion.div 
                                    variants={badgeHoverVariants}
                                    initial="initial"
                                    whileHover="hover"
                                  >
                                    <Badge
                                      status={deviceStatus.alarm_active ? 'success' : 'error'}
                                      text={deviceStatus.alarm_active ? 'Alarm Active' : 'Alarm Disabled'}
                                    />
                                  </motion.div>
                                ) : (
                                  <motion.div 
                                    variants={badgeHoverVariants}
                                    initial="initial"
                                    whileHover="hover"
                                  >
                                    <Badge
                                      status="default"
                                      text="Device Not Connected"
                                    />
                                  </motion.div>
                                )}
                              </Space>
                            </motion.div>
                          </Space>
                        </Space>
                      </motion.div>
                    ) : (
                      <motion.div
                        key="device-status-loading"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                      >
                        <Text>No device status available</Text>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </Card>
              </motion.div>

              {/* Alarm Settings Card */}
              <motion.div 
                variants={cardVariants}
                whileHover="hover"
                initial="initial"
              >
                <Card 
                  title={
                    <motion.div 
                      initial={{ x: -10, opacity: 0 }} 
                      animate={{ x: 0, opacity: 1 }}
                      transition={{ delay: 0.2 }}
                      whileHover={{ x: 3, transition: { duration: 0.3 } }}
                    >
                      Alarm Settings
                    </motion.div>
                  }
                  style={{ 
                    borderRadius: '12px',
                    overflow: 'hidden',
                    backdropFilter: 'blur(8px)',
                    backgroundColor: 'rgba(255, 255, 255, 0.9)',
                    transition: 'all 0.3s ease-in-out'
                  }}
                >
                  <Space direction="vertical" size="large" style={{ width: '100%' }}>
                    <motion.div 
                      variants={itemVariants}
                      whileHover={{ 
                        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.15)',
                        y: -5,
                        scale: 1.03,
                        transition: { type: "spring", stiffness: 300 }
                      }}
                    >
                      <div style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center',
                        padding: '20px',
                        background: 'rgba(245, 245, 245, 0.7)',
                        borderRadius: '12px',
                        backdropFilter: 'blur(5px)',
                        boxShadow: '0 4px 8px rgba(0, 0, 0, 0.05)'
                      }}>
                        <Space size={20}>
                          <motion.div
                            animate={{ 
                              rotate: [0, 360],
                              transition: { 
                                duration: 20, 
                                ease: "linear", 
                                repeat: Infinity 
                              }
                            }}
                            whileHover={{
                              scale: 1.2,
                              transition: { duration: 0.3 }
                            }}
                          >
                            <ClockCircleOutlined style={{ fontSize: '24px', color: '#1890ff' }} />
                          </motion.div>
                          <AntTimePicker
                            format="HH:mm"
                            value={timePickerValue}
                            onChange={(time) => {
                              if (!time) return;
                              const newTime = time.format('HH:mm');
                              setTimePickerValue(time);
                              Promise.resolve().then(() => {
                                updateAlarmTime(newTime);
                              });
                            }}
                            style={{ 
                              width: '130px',
                              borderRadius: '8px', 
                              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.05)',
                              border: '2px solid #f0f0f0'
                            }}
                            popupStyle={{ zIndex: 1000 }}
                          />
                        </Space>
                      </div>
                    </motion.div>
                  </Space>
                </Card>
              </motion.div>

              {/* Sensor Data Charts */}
              <Row gutter={[16, 16]}>
                <Col span={24}>
                  <motion.div 
                    variants={cardVariants}
                    whileHover="hover"
                    initial="initial"
                  >
                    <Card 
                      title={
                        <motion.div 
                          initial={{ x: -10, opacity: 0 }} 
                          animate={{ x: 0, opacity: 1 }}
                          transition={{ delay: 0.3 }}
                          whileHover={{ x: 3, transition: { duration: 0.3 } }}
                        >
                          CO2 Levels (ppm) - Last 24 Hours
                        </motion.div>
                      }
                      style={{ 
                        borderRadius: '12px',
                        overflow: 'hidden',
                        backdropFilter: 'blur(8px)',
                        backgroundColor: 'rgba(255, 255, 255, 0.9)',
                        transition: 'all 0.3s ease-in-out'
                      }}
                    >
                      <motion.div 
                        variants={itemVariants}
                        initial="hidden"
                        animate="visible"
                        whileHover={{ 
                          boxShadow: 'inset 0 0 20px rgba(0, 0, 0, 0.05)', 
                          transition: { duration: 0.5 } 
                        }}
                        style={{ 
                          width: '100%', 
                          height: 400, 
                          borderRadius: '8px',
                          padding: '8px',
                          background: 'rgba(250, 250, 250, 0.7)'
                        }}
                      >
                        <ResponsiveContainer>
                          <LineChart data={sensorData}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis 
                              dataKey="timestamp" 
                              tickFormatter={(timestamp) => new Date(timestamp).toLocaleTimeString()}
                            />
                            <YAxis 
                              domain={[0, 'auto']}
                              label={{ value: 'CO2 (ppm)', angle: -90, position: 'insideLeft' }}
                            />
                            <Tooltip 
                              formatter={(value: number) => [`${value} ppm`, 'CO2']}
                              labelFormatter={(timestamp) => new Date(timestamp).toLocaleString()}
                              contentStyle={{ 
                                backgroundColor: 'rgba(255, 255, 255, 0.95)',
                                borderRadius: '8px',
                                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
                                border: 'none',
                                padding: '10px'
                              }}
                            />
                            {/* Add reference lines for thresholds */}
                            <ReferenceLine y={CO2_THRESHOLDS.GOOD} stroke="#4CAF50" strokeDasharray="3 3" label="Good" />
                            <ReferenceLine y={CO2_THRESHOLDS.MODERATE} stroke="#FFC107" strokeDasharray="3 3" label="Moderate" />
                            <ReferenceLine y={CO2_THRESHOLDS.HIGH} stroke="#F44336" strokeDasharray="3 3" label="High" />
                            <Line 
                              type="monotone" 
                              dataKey="co2_level" 
                              stroke="#8884d8"
                              dot={false}
                              strokeWidth={3}
                              name="CO2"
                              activeDot={{ r: 8, strokeWidth: 2, stroke: '#fff' }}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </motion.div>
                      <motion.div variants={itemVariants} style={{ marginTop: 16 }}>
                        <Space wrap>
                          <Text>Legend:</Text>
                          <motion.div 
                            whileHover={{ 
                              scale: 1.08, 
                              x: 3,
                              textShadow: '0 0 5px rgba(76, 175, 80, 0.3)',
                              transition: { type: 'spring', stiffness: 300 }
                            }}
                          >
                            <Text style={{ color: '#4CAF50' }}>≤ {CO2_THRESHOLDS.GOOD} ppm: Good</Text>
                          </motion.div>
                          <motion.div 
                            whileHover={{ 
                              scale: 1.08, 
                              x: 3,
                              textShadow: '0 0 5px rgba(255, 193, 7, 0.3)',
                              transition: { type: 'spring', stiffness: 300 }
                            }}
                          >
                            <Text style={{ color: '#FFC107' }}>{CO2_THRESHOLDS.GOOD}-{CO2_THRESHOLDS.MODERATE} ppm: Moderate</Text>
                          </motion.div>
                          <motion.div 
                            whileHover={{ 
                              scale: 1.08, 
                              x: 3,
                              textShadow: '0 0 5px rgba(255, 152, 0, 0.3)',
                              transition: { type: 'spring', stiffness: 300 }
                            }}
                          >
                            <Text style={{ color: '#FF9800' }}>{CO2_THRESHOLDS.MODERATE}-{CO2_THRESHOLDS.HIGH} ppm: High</Text>
                          </motion.div>
                          <motion.div 
                            whileHover={{ 
                              scale: 1.08, 
                              x: 3,
                              textShadow: '0 0 5px rgba(244, 67, 54, 0.3)',
                              transition: { type: 'spring', stiffness: 300 }
                            }}
                          >
                            <Text style={{ color: '#F44336' }}>≥ {CO2_THRESHOLDS.HIGH} ppm: Very High</Text>
                          </motion.div>
                        </Space>
                      </motion.div>
                    </Card>
                  </motion.div>
                </Col>
              </Row>
            </Space>
          </Content>
        </Layout>
      </Layout>
    </motion.div>
  );
}

export default App;
