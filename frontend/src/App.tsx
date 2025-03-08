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
  Button
} from '@arco-design/web-react';
import { IconExclamationCircle, IconHome } from '@arco-design/web-react/icon';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import axios from 'axios';
import dayjs, { Dayjs } from 'dayjs';

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
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        theme='dark'
        breakpoint='lg'
        onCollapse={onCollapse}
        collapsed={collapsed}
        width={220}
        collapsible
      >
        <Menu
          theme='dark'
          defaultSelectedKeys={['waku']}
          style={{ width: '100%' }}
        >
          <MenuItem key='waku'>
            <IconHome />
            Waku
          </MenuItem>
        </Menu>
      </Sider>
      <Layout>
        <Content style={{ padding: '20px' }}>
          <Title heading={2}>Home Server Dashboard</Title>

          <Space direction="vertical" size="large" style={{ width: '100%', display: 'flex' }}>
            {/* Device Status Card */}
            <Card title="Device Status">
              {deviceStatus ? (
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Text>Last Seen: {deviceStatus.last_seen ? new Date(deviceStatus.last_seen).toLocaleString() : "Never connected"}</Text>
                  <Progress
                    percent={progress}
                    status={isUpdateOverdue ? 'error' : 'normal'}
                    formatText={() => `${Math.round(progress)}%`}
                    animation
                  />
                  {deviceStatus.error_code && (
                    <Alert
                      type={deviceStatus.error_code === "NO_ERROR" ? "success" : "error"}
                      content={deviceStatus.error_code === "NO_ERROR" ? "DEVICE OPERATES CORRECTLY" : deviceStatus.error_code}
                      icon={<IconExclamationCircle />}
                    />
                  )}
                  {deviceStatus.alarm_active && (
                    <Alert
                      type="warning"
                      title="Alarm Active"
                      content={`Active for ${deviceStatus.alarm_active_time} seconds`}
                      icon={<IconExclamationCircle />}
                    />
                  )}
                  <Space>
                    <Button
                      type="primary"
                      status="success"
                      onClick={handleEnableAlarm}
                      disabled={deviceStatus.alarm_enabled}
                    >
                      Enable Alarm
                    </Button>
                    <Button
                      type="primary"
                      status="danger"
                      onClick={handleDisableAlarm}
                      disabled={!deviceStatus.alarm_enabled}
                    >
                      Disable Alarm
                    </Button>
                  </Space>
                </Space>
              ) : (
                <Text>No device status available</Text>
              )}
            </Card>

            {/* Alarm Settings Card */}
            <Card title="Alarm Settings">
              <Space direction="vertical" size="large">
                <Space>
                  <TimePicker
                    format="HH:mm"
                    value={timePickerValue}
                    onChange={(valueString: string, time: Dayjs) => {
                      if (!time) return;
                      const newTime = time.format('HH:mm');
                      setTimePickerValue(time);
                      // Use Promise.resolve to ensure we're not blocking the render
                      Promise.resolve().then(() => {
                        updateAlarmTime(newTime);
                      });
                    }}
                  />
                </Space>
              </Space>
            </Card>

            {/* Sensor Data Charts */}
            <Row gutter={[16, 16]}>
              <Col span={24}>
                <Card title="CO2 Levels (ppm) - Last 24 Hours">
                  <div style={{ width: '100%', height: 400 }}>
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
                          strokeWidth={2}
                          name="CO2"
                          activeDot={{ r: 8 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <Space style={{ marginTop: 16 }}>
                    <Text>Legend:</Text>
                    <Text style={{ color: '#4CAF50' }}>≤ {CO2_THRESHOLDS.GOOD} ppm: Good</Text>
                    <Text style={{ color: '#FFC107' }}>{CO2_THRESHOLDS.GOOD}-{CO2_THRESHOLDS.MODERATE} ppm: Moderate</Text>
                    <Text style={{ color: '#FF9800' }}>{CO2_THRESHOLDS.MODERATE}-{CO2_THRESHOLDS.HIGH} ppm: High</Text>
                    <Text style={{ color: '#F44336' }}>≥ {CO2_THRESHOLDS.HIGH} ppm: Very High</Text>
                  </Space>
                </Card>
              </Col>
            </Row>
          </Space>
        </Content>
      </Layout>
    </Layout>
  );
}

export default App;
